import { describe, expect, it } from "vitest";

// A "smoke test" only proves the test setup itself works.
// If this fails, the problem is the tooling, not your code.
describe("test setup", () => {
  it("runs a basic assertion", () => {
    expect(1 + 1).toBe(2);
  });
});
