import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, fetchText } from "../src/lib/http";

const URL = "https://example.teamtailor.com/jobs.rss";
const options = { userAgent: "JobRadarDK/test", retryDelayMs: 0 };

function mockFetch(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchText", () => {
  it("returns the body of a 200 response", async () => {
    const fetchMock = mockFetch(new Response("<rss/>", { status: 200 }));
    await expect(fetchText(URL, options)).resolves.toBe("<rss/>");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the User-Agent header", async () => {
    const fetchMock = mockFetch(new Response("ok"));
    await fetchText(URL, options);
    expect(fetchMock).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({ headers: { "User-Agent": "JobRadarDK/test" } }),
    );
  });

  it("retries once after a 500 and returns the second response", async () => {
    const fetchMock = mockFetch(new Response("down", { status: 500 }), new Response("<rss/>"));
    await expect(fetchText(URL, options)).resolves.toBe("<rss/>");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after a second 5xx and throws the status", async () => {
    const fetchMock = mockFetch(new Response("", { status: 502 }), new Response("", { status: 503 }));
    const error = await fetchText(URL, options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 503, url: URL });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([404, 403, 429])("throws on %i without retrying", async (status) => {
    const fetchMock = mockFetch(new Response("", { status }));
    await expect(fetchText(URL, options)).rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once after a network error", async () => {
    const fetchMock = mockFetch(new TypeError("fetch failed"), new Response("<rss/>"));
    await expect(fetchText(URL, options)).resolves.toBe("<rss/>");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts a request that takes longer than the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    );
    await expect(fetchText(URL, { ...options, timeoutMs: 20 })).rejects.toThrow(/timeout|aborted/i);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("waits before retrying", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = mockFetch(new Response("", { status: 500 }), new Response("ok"));
      const promise = fetchText(URL, { userAgent: "x" });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(promise).resolves.toBe("ok");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
