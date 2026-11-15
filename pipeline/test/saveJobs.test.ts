import { describe, expect, it } from "vitest";
import type { NormalizedJob } from "../src/sources/types";
import { buildJobRows } from "../src/steps/saveJobs";

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

describe("buildJobRows", () => {
  it("turns a normalized job into a database row for the company", () => {
    expect(buildJobRows([job], "company-1", false)).toEqual([
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
      },
    ]);
  });

  it("marks baseline jobs so they are never scored or emailed", () => {
    const [row] = buildJobRows([job], "company-1", true);
    expect(row).toMatchObject({ isBaseline: true, scoreStatus: "NOT_NEEDED" });
  });

  it("leaves out the company name, which lives on the Company row", () => {
    const [row] = buildJobRows([job], "company-1", false);
    expect(row).not.toHaveProperty("company");
  });

  it("returns no rows for no jobs", () => {
    expect(buildJobRows([], "company-1", true)).toEqual([]);
  });
});
