import { describe, expect, it } from "vitest";
import type { NormalizedJob } from "../src/sources/types";
import { buildJobRows, fetchStatusFor } from "../src/steps/saveJobs";

const job: NormalizedJob = {
  externalId: "b1df10ef",
  title: "Full Stack Engineer",
  company: "Example Co",
  location: "København, Denmark",
  remoteType: "hybrid",
  description: "We are hiring.",
  url: "https://example.com/jobs/1",
  postedAt: new Date("2026-11-09T20:20:10Z"),
};

const now = new Date("2026-11-15T12:00:00Z");

describe("buildJobRows", () => {
  it("turns a normalized job into a database row for the company", () => {
    expect(buildJobRows([job], "company-1", false, now)).toEqual([
      {
        externalId: "b1df10ef",
        title: "Full Stack Engineer",
        location: "København, Denmark",
        remoteType: "hybrid",
        description: "We are hiring.",
        url: "https://example.com/jobs/1",
        postedAt: new Date("2026-11-09T20:20:10Z"),
        companyId: "company-1",
        isBaseline: false,
        scoreStatus: "PENDING",
        firstSeenAt: now,
        lastSeenAt: now,
      },
    ]);
  });

  it("marks baseline jobs so they are never scored or emailed", () => {
    const [row] = buildJobRows([job], "company-1", true, now);
    expect(row).toMatchObject({ isBaseline: true, scoreStatus: "NOT_NEEDED" });
  });

  it("leaves out the company name, which lives on the Company row", () => {
    const [row] = buildJobRows([job], "company-1", false, now);
    expect(row).not.toHaveProperty("company");
  });

  it("returns no rows for no jobs", () => {
    expect(buildJobRows([], "company-1", true, now)).toEqual([]);
  });
});

describe("fetchStatusFor", () => {
  it.each([
    { open: 19, incoming: 18, expected: "OK", why: "jobs came back" },
    { open: 0, incoming: 4, expected: "OK", why: "first jobs for a company" },
    { open: 0, incoming: 0, expected: "EMPTY", why: "nothing before, nothing now (normal)" },
    { open: 19, incoming: 0, expected: "SUSPICIOUS_EMPTY", why: "had jobs, now none (maybe broken)" },
    { open: 1, incoming: 0, expected: "SUSPICIOUS_EMPTY", why: "even one open job counts" },
  ])("$expected when $why", ({ open, incoming, expected }) => {
    expect(fetchStatusFor(open, incoming)).toBe(expected);
  });
});
