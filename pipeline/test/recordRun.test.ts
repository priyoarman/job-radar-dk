import { describe, expect, it } from "vitest";
import type { CompanyOutcome } from "../src/steps/fetchCompanies";
import { healthUpdateFor, runStatusFor, runTriggerFor, summarizeOutcomes } from "../src/steps/recordRun";

const outcome = (status: CompanyOutcome["status"], overrides: Partial<CompanyOutcome> = {}): CompanyOutcome => ({
  companyId: "id",
  slug: "x",
  status,
  httpStatus: null,
  jobsFound: 0,
  jobsNew: 0,
  jobsPassed: 0,
  jobsClosed: 0,
  error: null,
  durationMs: status === "SKIPPED_RECENT" ? null : 100,
  ...overrides,
});

describe("runTriggerFor", () => {
  it.each([
    ["schedule", "cron"],
    ["push", "local"],
    [undefined, "local"],
  ])("%s → %s", (eventName, expected) => {
    expect(runTriggerFor(eventName)).toBe(expected);
  });

  it.each([
    ["scheduler", "scheduler"],
    ["manual", "manual"],
    [undefined, "manual"],
    ["", "manual"],
    ["something-else", "manual"],
  ])("workflow_dispatch with source %j → %s", (source, expected) => {
    expect(runTriggerFor("workflow_dispatch", source)).toBe(expected);
  });

  it("ignores the source for a GitHub schedule run", () => {
    expect(runTriggerFor("schedule", "scheduler")).toBe("cron");
  });
});

describe("summarizeOutcomes", () => {
  it("adds up the funnel counts", () => {
    const outcomes = [
      outcome("OK", { jobsFound: 19, jobsNew: 2, jobsPassed: 1 }),
      outcome("OK", { jobsFound: 4, jobsNew: 1, jobsPassed: 0 }),
      outcome("EMPTY"),
      outcome("SUSPICIOUS_EMPTY"),
      outcome("ERROR", { error: "HTTP 500" }),
      outcome("SKIPPED_RECENT"),
      outcome("SKIPPED_RECENT"),
    ];
    expect(summarizeOutcomes(outcomes)).toEqual({
      companiesChecked: 5,
      companiesSkipped: 2,
      companiesFailed: 1,
      jobsFetched: 23,
      jobsNew: 3,
      jobsPassedFilter: 1,
    });
  });

  it("counts a company blocked by robots.txt as skipped, not checked or failed", () => {
    expect(summarizeOutcomes([outcome("OK"), outcome("SKIPPED_ROBOTS"), outcome("SKIPPED_RECENT")])).toMatchObject({
      companiesChecked: 1,
      companiesSkipped: 2,
      companiesFailed: 0,
    });
  });

  it("returns zeros for a run with no companies", () => {
    expect(summarizeOutcomes([])).toEqual({
      companiesChecked: 0,
      companiesSkipped: 0,
      companiesFailed: 0,
      jobsFetched: 0,
      jobsNew: 0,
      jobsPassedFilter: 0,
    });
  });
});

describe("runStatusFor", () => {
  it.each([
    [["OK", "EMPTY", "SKIPPED_RECENT"], "SUCCESS"],
    [["SUSPICIOUS_EMPTY"], "SUCCESS"],
    [[], "SUCCESS"],
    [["OK", "ERROR"], "PARTIAL"],
    [["ERROR", "ERROR"], "PARTIAL"],
    [["OK", "SKIPPED_ROBOTS"], "SUCCESS"],
  ] as const)("%j → %s", (statuses, expected) => {
    expect(runStatusFor(statuses.map((s) => outcome(s)))).toBe(expected);
  });
});

describe("healthUpdateFor", () => {
  it("counts a failure and stores its message", () => {
    expect(healthUpdateFor(outcome("ERROR", { error: "HTTP 404" }))).toEqual({
      consecutiveFailures: { increment: 1 },
      lastError: "HTTP 404",
    });
  });

  it.each(["OK", "EMPTY", "SUSPICIOUS_EMPTY"] as const)("resets the failure count after %s", (status) => {
    expect(healthUpdateFor(outcome(status))).toEqual({ consecutiveFailures: 0, lastError: null });
  });

  it("keeps the failure count but stores the reason when robots.txt blocks a company", () => {
    expect(healthUpdateFor(outcome("SKIPPED_ROBOTS", { error: "robots-disallowed: https://x/search/" }))).toEqual({
      lastError: "robots-disallowed: https://x/search/",
    });
  });

  it("leaves a skipped company unchanged", () => {
    expect(healthUpdateFor(outcome("SKIPPED_RECENT"))).toBeNull();
  });
});
