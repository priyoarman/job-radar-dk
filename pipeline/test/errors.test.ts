import { describe, expect, it } from "vitest";
import { errorMessage } from "../src/lib/errors";

describe("errorMessage", () => {
  it("returns an Error's message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("adds the hidden cause of a network error", () => {
    const error = new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND zz.invalid") });
    expect(errorMessage(error)).toBe("fetch failed: getaddrinfo ENOTFOUND zz.invalid");
  });

  it("does not repeat a cause that is already in the message", () => {
    expect(errorMessage(new Error("timeout after 15s", { cause: new Error("timeout") }))).toBe("timeout after 15s");
  });

  it("handles things that are not Errors", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
  });

  it("cuts very long messages so they fit in a log line and a database column", () => {
    const message = errorMessage(new Error("x".repeat(2_000)));
    expect(message).toHaveLength(500);
    expect(message.endsWith("…")).toBe(true);
  });
});
