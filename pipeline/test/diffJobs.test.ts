import { describe, expect, it } from "vitest";
import type { NormalizedJob } from "../src/sources/types";
import { type ExistingJob, diffJobs } from "../src/steps/diffJobs";

const job = (externalId: string, title = `Job ${externalId}`): NormalizedJob => ({
  externalId,
  title,
  company: "Example Co",
  location: null,
  remoteType: null,
  description: "",
  url: `https://example.com/jobs/${externalId}`,
  postedAt: null,
});

const open = (externalId: string): ExistingJob => ({ externalId, closedAt: null });
const closed = (externalId: string): ExistingJob => ({ externalId, closedAt: new Date("2026-11-01") });

type Case = {
  name: string;
  existing: ExistingJob[];
  incoming: string[];
  newIds: string[];
  seenIds: string[];
  goneIds: string[];
};

const cases: Case[] = [
  { name: "first fetch: everything is new", existing: [], incoming: ["a", "b"], newIds: ["a", "b"], seenIds: [], goneIds: [] },
  { name: "nothing changed", existing: [open("a"), open("b")], incoming: ["a", "b"], newIds: [], seenIds: ["a", "b"], goneIds: [] },
  { name: "one new job", existing: [open("a")], incoming: ["a", "b"], newIds: ["b"], seenIds: ["a"], goneIds: [] },
  { name: "one job removed", existing: [open("a"), open("b")], incoming: ["a"], newIds: [], seenIds: ["a"], goneIds: ["b"] },
  { name: "new, seen and gone at once", existing: [open("a"), open("b")], incoming: ["b", "c"], newIds: ["c"], seenIds: ["b"], goneIds: ["a"] },
  { name: "a closed job that comes back is seen, not new", existing: [closed("a")], incoming: ["a"], newIds: [], seenIds: ["a"], goneIds: [] },
  { name: "a closed job that stays away is not gone again", existing: [closed("a"), open("b")], incoming: ["b"], newIds: [], seenIds: ["b"], goneIds: [] },
  { name: "empty feed: every open job is gone", existing: [open("a"), closed("b")], incoming: [], newIds: [], seenIds: [], goneIds: ["a"] },
  { name: "empty feed and empty database", existing: [], incoming: [], newIds: [], seenIds: [], goneIds: [] },
  { name: "a job listed twice in the feed counts once", existing: [open("a")], incoming: ["a", "b", "a", "b"], newIds: ["b"], seenIds: ["a"], goneIds: [] },
  { name: "ids are case-sensitive", existing: [open("abc")], incoming: ["ABC"], newIds: ["ABC"], seenIds: [], goneIds: ["abc"] },
];

describe("diffJobs", () => {
  it.each(cases)("$name", ({ existing, incoming, newIds, seenIds, goneIds }) => {
    const diff = diffJobs(existing, incoming.map((id) => job(id)));
    expect(diff.newJobs.map((j) => j.externalId)).toEqual(newIds);
    expect(diff.seenIds).toEqual(seenIds);
    expect(diff.goneIds).toEqual(goneIds);
  });

  it("returns the full job for new jobs, keeping the first copy of a duplicate", () => {
    const { newJobs } = diffJobs([], [job("a", "First"), job("a", "Second")]);
    expect(newJobs).toEqual([job("a", "First")]);
  });

  it("keeps the feed order", () => {
    const { newJobs } = diffJobs([], ["c", "a", "b"].map((id) => job(id)));
    expect(newJobs.map((j) => j.externalId)).toEqual(["c", "a", "b"]);
  });

  it("does not change its inputs", () => {
    const existing = [open("a")];
    const incoming = [job("a"), job("b")];
    const before = structuredClone({ existing, incoming });
    diffJobs(existing, incoming);
    expect({ existing, incoming }).toEqual(before);
  });

  it("puts every incoming id in exactly one of new or seen", () => {
    const existing = [open("a"), closed("b"), open("c")];
    const incoming = ["a", "b", "d", "e"].map((id) => job(id));
    const { newJobs, seenIds } = diffJobs(existing, incoming);
    const all = [...newJobs.map((j) => j.externalId), ...seenIds].sort();
    expect(all).toEqual(["a", "b", "d", "e"]);
  });
});
