import { describe, expect, it } from "vitest";
import { type NormalizedJob, normalizedJobSchema } from "../src/sources/types";

const valid: NormalizedJob = {
  externalId: "b1df10ef-b0dd-45e6-99b6-6b07da9fd819",
  title: "Full Stack Engineer",
  company: "Example Co",
  location: "København",
  remoteType: "hybrid",
  description: "We are hiring.",
  url: "https://jobs.example.com/jobs/123-full-stack-engineer",
  postedAt: new Date("2026-11-09T20:20:10Z"),
};

describe("normalizedJobSchema", () => {
  it("accepts a complete job", () => {
    expect(normalizedJobSchema.parse(valid)).toEqual(valid);
  });

  it("accepts unknown location, remote type and date as null", () => {
    const job = { ...valid, location: null, remoteType: null, postedAt: null };
    expect(normalizedJobSchema.safeParse(job).success).toBe(true);
  });

  it("trims the title", () => {
    expect(normalizedJobSchema.parse({ ...valid, title: "  Developer \n" }).title).toBe("Developer");
  });

  it.each([
    ["an empty externalId", { externalId: " " }, "externalId"],
    ["an empty title", { title: "" }, "title"],
    ["an empty location instead of null", { location: "" }, "location"],
    ["an unknown remoteType", { remoteType: "fully" }, "remoteType"],
    ["a relative url", { url: "/jobs/123" }, "url"],
    ["a non-http url", { url: "javascript:alert(1)" }, "url"],
    ["an Invalid Date", { postedAt: new Date("not a date") }, "postedAt"],
    ["a date string instead of a Date", { postedAt: "2026-11-09" }, "postedAt"],
  ])("rejects %s", (_label, change, field) => {
    const result = normalizedJobSchema.safeParse({ ...valid, ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0])).toContain(field);
  });
});
