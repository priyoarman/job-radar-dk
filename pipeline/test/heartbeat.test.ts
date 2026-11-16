import { afterEach, describe, expect, it, vi } from "vitest";
import { heartbeatUrl, sendHeartbeat } from "../src/lib/heartbeat";

const BASE = "https://hc-ping.com/1234-abcd";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("heartbeatUrl", () => {
  it.each([
    ["SUCCESS", BASE],
    ["PARTIAL", BASE],
    ["FAILED", `${BASE}/fail`],
  ] as const)("%s → %s", (status, expected) => {
    expect(heartbeatUrl(BASE, status)).toBe(expected);
  });

  it("ignores a trailing slash", () => {
    expect(heartbeatUrl(`${BASE}/`, "FAILED")).toBe(`${BASE}/fail`);
  });
});

describe("sendHeartbeat", () => {
  it("does nothing when no URL is configured", async () => {
    const fetchFn = vi.fn();
    await sendHeartbeat(undefined, "SUCCESS", fetchFn);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("pings the check after a run", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("OK"));
    await sendHeartbeat(BASE, "PARTIAL", fetchFn);
    expect(fetchFn).toHaveBeenCalledExactlyOnceWith(BASE, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("never fails the run when the ping fails, but logs a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(sendHeartbeat(BASE, "SUCCESS", vi.fn().mockRejectedValue(new TypeError("fetch failed")))).resolves.toBeUndefined();
    await expect(sendHeartbeat(BASE, "SUCCESS", vi.fn().mockResolvedValue(new Response("", { status: 404 })))).resolves.toBeUndefined();
    expect(warn.mock.calls.map(([line]) => String(line))).toEqual([
      expect.stringMatching(/heartbeat\.failed .*fetch failed/),
      expect.stringMatching(/heartbeat\.failed .*"httpStatus":404/),
    ]);
  });
});
