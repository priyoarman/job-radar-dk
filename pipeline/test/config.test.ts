import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const DATABASE_URL = "postgresql://user:pass@host-pooler.neon.tech/db?sslmode=verify-full";
const sending = { DATABASE_URL, RESEND_API_KEY: "re_123", EMAIL_TO: "me@example.com" };

describe("loadConfig", () => {
  it("parses a valid env and fills in defaults", () => {
    expect(loadConfig(sending)).toEqual({
      ...sending,
      DRY_RUN: false,
      EMAIL_FROM: "Job Radar <onboarding@resend.dev>",
      USER_AGENT: "JobRadarDK/1.0 (personal job alert bot)",
      MIN_FETCH_INTERVAL_HOURS: 2.5,
      APP_BASE_URL: "http://localhost:3000",
    });
  });

  it("names DATABASE_URL when it is missing", () => {
    expect(() => loadConfig({ DRY_RUN: "true" })).toThrow("DATABASE_URL: required");
  });

  it("rejects a DATABASE_URL that is not postgres", () => {
    expect(() => loadConfig({ DATABASE_URL: "mysql://x@y/z", DRY_RUN: "true" })).toThrow(
      "DATABASE_URL: must be a postgresql:// URL",
    );
  });

  it("treats empty strings as missing, like unset GitHub secrets", () => {
    expect(() => loadConfig({ ...sending, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
    expect(loadConfig({ ...sending, MIN_FETCH_INTERVAL_HOURS: "" }).MIN_FETCH_INTERVAL_HOURS).toBe(2.5);
  });

  it.each([
    ["true", true],
    ["false", false],
    ["1", true],
    ["0", false],
  ])("reads DRY_RUN=%s as %s", (raw, expected) => {
    expect(loadConfig({ ...sending, DRY_RUN: raw }).DRY_RUN).toBe(expected);
  });

  it("rejects a DRY_RUN value that is not a boolean", () => {
    expect(() => loadConfig({ ...sending, DRY_RUN: "yes please" })).toThrow(/DRY_RUN/);
  });

  it("turns MIN_FETCH_INTERVAL_HOURS into a number", () => {
    expect(loadConfig({ ...sending, MIN_FETCH_INTERVAL_HOURS: "3" }).MIN_FETCH_INTERVAL_HOURS).toBe(3);
  });

  it("rejects a non-numeric MIN_FETCH_INTERVAL_HOURS", () => {
    expect(() => loadConfig({ ...sending, MIN_FETCH_INTERVAL_HOURS: "soon" })).toThrow(
      /MIN_FETCH_INTERVAL_HOURS/,
    );
  });

  it("requires the email settings when not in dry-run mode", () => {
    expect(() => loadConfig({ DATABASE_URL })).toThrow(
      /RESEND_API_KEY: required unless DRY_RUN=true[\s\S]*EMAIL_TO: required unless DRY_RUN=true/,
    );
  });

  it("does not need the email settings in dry-run mode", () => {
    expect(loadConfig({ DATABASE_URL, DRY_RUN: "true" }).DRY_RUN).toBe(true);
  });

  it("reports missing email settings together with other problems", () => {
    expect(() => loadConfig({})).toThrow(
      /DATABASE_URL: required[\s\S]*RESEND_API_KEY: required unless DRY_RUN=true[\s\S]*EMAIL_TO: required unless DRY_RUN=true/,
    );
  });

  it("does not guess about email settings when DRY_RUN itself is invalid", () => {
    expect(() => loadConfig({ DATABASE_URL, DRY_RUN: "yes please" })).toThrow(/DRY_RUN/);
    expect(() => loadConfig({ DATABASE_URL, DRY_RUN: "yes please" })).not.toThrow(/RESEND_API_KEY/);
  });

  it("lists every problem at once", () => {
    expect(() => loadConfig({ EMAIL_TO: "not-an-email", DRY_RUN: "true" })).toThrow(
      /DATABASE_URL[\s\S]*EMAIL_TO/,
    );
  });
});
