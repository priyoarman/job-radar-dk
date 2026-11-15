import { afterEach, describe, expect, it, vi } from "vitest";
import { formatLine, log } from "../src/lib/logger";

describe("formatLine", () => {
  it("prints the event and its fields as one line of JSON", () => {
    expect(formatLine("info", "fetch.ok", { company: "x", jobs: 5 })).toBe(
      'fetch.ok {"company":"x","jobs":5}',
    );
  });

  it("prints only the event when there are no fields", () => {
    expect(formatLine("info", "run.start")).toBe("run.start");
    expect(formatLine("info", "run.start", {})).toBe("run.start");
  });

  it("prefixes warnings and errors so they are easy to search for", () => {
    expect(formatLine("warn", "fetch.empty", { company: "x" })).toBe('WARN fetch.empty {"company":"x"}');
    expect(formatLine("error", "run.failed")).toBe("ERROR run.failed");
  });

  it("shows an Error's message instead of {}", () => {
    expect(formatLine("error", "fetch.error", { error: new Error("timeout") })).toBe(
      'ERROR fetch.error {"error":"timeout"}',
    );
  });

  it("keeps multi-line text on one line", () => {
    expect(formatLine("info", "x", { text: "a\nb" })).toBe('x {"text":"a\\nb"}');
  });
});

describe("log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends info to stdout and warnings/errors to stderr", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    log.info("a", { n: 1 });
    log.warn("b");
    log.error("c");

    expect(out).toHaveBeenCalledWith('a {"n":1}');
    expect(warn).toHaveBeenCalledWith("WARN b");
    expect(err).toHaveBeenCalledWith("ERROR c");
  });
});
