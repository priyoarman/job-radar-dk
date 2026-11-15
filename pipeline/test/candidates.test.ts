import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HttpError } from "../src/lib/http";
import {
  type Candidate,
  type CandidateResult,
  candidateSchema,
  probeFromClaim,
  probesFor,
  slugFor,
  summarize,
  verifyCandidate,
} from "../src/tools/candidates";

const fixture = (path: string) => readFileSync(resolve(import.meta.dirname, "fixtures", path), "utf8");

const candidate = (overrides: Partial<Candidate>): Candidate => ({
  id: 1,
  name: "Example",
  category: "saas",
  claimed: ["GREENHOUSE"],
  claimedUrl: null,
  ...overrides,
});

function http(routes: Record<string, string>) {
  const call = async (url: string) => {
    for (const [prefix, body] of Object.entries(routes)) if (url.startsWith(prefix)) return body;
    throw new HttpError(url, 404);
  };
  return {
    text: vi.fn(call),
    json: vi.fn(async (url: string) => JSON.parse(await call(url))),
  };
}

describe("config/candidates.json", () => {
  it("holds the 150 companies from the list, each valid", () => {
    const rows = z.array(candidateSchema).parse(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../config/candidates.json"), "utf8")));
    expect(rows).toHaveLength(150);
    expect(new Set(rows.map((r) => r.id)).size).toBe(150);
  });
});

describe("slugFor", () => {
  it.each([
    ["Trustpilot", "trustpilot"],
    ["Electricity Maps", "electricitymaps"],
    ["Zapier Denmark", "zapier"],
    ["e-conomic (Visma)", "economic"],
    ["Peakon / Workday", "peakon"],
    ["Ørsted", "orsted"],
    ["EG A/S", "eg"],
    ["Shape ApS", "shape"],
    ["Butter.us", "butter"],
    ["one.com", "one"],
    ["proprty.ai", "proprty"],
  ])("%s → %s", (name, slug) => {
    expect(slugFor(name)).toBe(slug);
  });
});

describe("probeFromClaim", () => {
  it.each([
    ["formalize.teamtailor.com", { source: "TEAMTAILOR", key: "https://formalize.teamtailor.com" }],
    ["boards.greenhouse.io/pleo", { source: "GREENHOUSE", key: "pleo" }],
    ["jobs.lever.co/zeronorth", { source: "LEVER", key: "zeronorth" }],
    ["apply.workable.com/electricitymaps", { source: "WORKABLE", key: "electricitymaps" }],
    ["jobs.ashbyhq.com/pleo", { source: "ASHBY", key: "pleo" }],
    ["signifly.recruitee.com", { source: "RECRUITEE", key: "signifly" }],
  ])("%s → %j", (url, expected) => {
    expect(probeFromClaim(url)).toEqual({ ...expected, fromClaim: true });
  });

  it.each(["maersk.wd3.myworkdayjobs.com", "bankdata.emply.net", "careers.monta.com", "jobs.smartrecruiters.com/Visma", null])(
    "has no supported board for %s",
    (url) => {
      expect(probeFromClaim(url)).toBeNull();
    },
  );
});

describe("probesFor", () => {
  it("tries the claimed board first, then the name on every cheap portal, without repeats", () => {
    const probes = probesFor(candidate({ name: "Trustpilot", claimedUrl: "boards.greenhouse.io/trustpilot" }));
    expect(probes.map((p) => `${p.source}:${p.key}`)).toEqual([
      "GREENHOUSE:trustpilot",
      "TEAMTAILOR:https://trustpilot.teamtailor.com",
      "LEVER:trustpilot",
      "LEVER_EU:eu:trustpilot",
      "ASHBY:trustpilot",
      "WORKABLE:trustpilot",
      "RECRUITEE:trustpilot",
    ]);
    expect(probes[0]?.fromClaim).toBe(true);
  });
});

describe("verifyCandidate", () => {
  it("skips companies that are already watched, without requests", async () => {
    const client = http({});
    const result = await verifyCandidate(candidate({ watchedSlug: "pleo" }), client);
    expect(result).toMatchObject({ status: "already-watched", requests: 0 });
    expect(client.text).not.toHaveBeenCalled();
  });

  it("confirms a correct claim with one request and counts Danish jobs and matches", async () => {
    const client = http({ "https://boards-api.greenhouse.io/v1/boards/trustpilot/": fixture("greenhouse/trustpilot.json") });
    const result = await verifyCandidate(candidate({ name: "Trustpilot", claimedUrl: "boards.greenhouse.io/trustpilot" }), client);
    expect(result).toMatchObject({ status: "confirmed", source: "GREENHOUSE", sourceKey: "trustpilot", claimCorrect: true, requests: 1 });
    expect(result.counts).toEqual({ jobs: 29, inDenmark: 9, matches: 0 });
  });

  it("finds the real board when the claim is wrong, and marks the claim as wrong", async () => {
    const client = http({ "https://lever.example": "", "https://api.lever.co/v0/postings/veo": fixture("lever/veo.json") });
    const result = await verifyCandidate(candidate({ name: "Veo", claimed: ["GREENHOUSE"], claimedUrl: "boards.greenhouse.io/veo" }), client);
    expect(result).toMatchObject({ status: "confirmed", source: "LEVER", sourceKey: "veo", claimCorrect: false });
    expect(result.counts?.matches).toBe(5);
  });

  it("reports an existing board with 0 jobs when nothing better is found", async () => {
    const client = http({ "https://vivino.teamtailor.com/jobs.rss": fixture("teamtailor/vivino-empty.rss") });
    const result = await verifyCandidate(candidate({ name: "Vivino", claimed: ["TEAMTAILOR"], claimedUrl: "vivino.teamtailor.com" }), client);
    expect(result).toMatchObject({ status: "confirmed-empty", source: "TEAMTAILOR", claimCorrect: true, counts: { jobs: 0 } });
  });

  it("marks an Emply claim as not verifiable, without requesting emply.net", async () => {
    const client = http({});
    const result = await verifyCandidate(candidate({ name: "Energinet", claimed: ["EMPLY"], claimedUrl: "energinet.emply.net" }), client);
    expect(result).toMatchObject({ status: "unverified-unsupported", source: "EMPLY", requests: 7 });
    expect(client.text.mock.calls.some(([url]) => url.includes("emply"))).toBe(false);
  });

  it("counts SmartRecruiters jobs in Denmark for claimed SmartRecruiters companies", async () => {
    const body = JSON.stringify({ totalFound: 3, content: [{ location: { country: "dk" } }, { location: { country: "de" } }, { location: { country: "DK" } }] });
    const client = http({ "https://api.smartrecruiters.com/v1/companies/Bestseller/": body });
    const result = await verifyCandidate(candidate({ name: "Bestseller Tech", claimed: ["SMARTRECRUITERS"], claimedUrl: "jobs.smartrecruiters.com/Bestseller" }), client);
    expect(result).toMatchObject({ status: "exists-unsupported", source: "SMARTRECRUITERS", counts: { jobs: 3, inDenmark: 2 } });
  });

  it("does not let an empty board on an unclaimed system decide the result", async () => {
    const client = http({ "https://apply.workable.com/api/v1/widget/accounts/energinet": JSON.stringify({ name: "x", jobs: [] }) });
    const result = await verifyCandidate(candidate({ name: "Energinet", claimed: ["EMPLY"], claimedUrl: "energinet.emply.net" }), client);
    expect(result).toMatchObject({ status: "unverified-unsupported", source: "EMPLY" });
    expect(result.note).toContain("an empty WORKABLE board exists");
  });

  it("does not count SmartRecruiters' 0-job answer as proof the company exists", async () => {
    const client = http({ "https://api.smartrecruiters.com/v1/companies/Nobody/": JSON.stringify({ totalFound: 0, content: [] }) });
    const result = await verifyCandidate(candidate({ name: "Nobody", claimed: ["SMARTRECRUITERS"], claimedUrl: "jobs.smartrecruiters.com/Nobody" }), client);
    expect(result.status).toBe("not-found");
  });

  it("sends Workday and SuccessFactors claims to a manual check", async () => {
    const result = await verifyCandidate(candidate({ name: "SimCorp", claimed: ["WORKDAY"], claimedUrl: "simcorp.wd3.myworkdayjobs.com" }), http({}));
    expect(result).toMatchObject({ status: "manual" });
  });

  it("reports not-found when nothing answers", async () => {
    const result = await verifyCandidate(candidate({ name: "Baltech", claimed: ["CUSTOM"], claimedUrl: "baltech.dk" }), http({}));
    expect(result).toMatchObject({ status: "not-found" });
    expect(result.requests).toBe(7);
  });
});

describe("summarize", () => {
  it("counts statuses, sources, correct claims and requests", () => {
    const results: CandidateResult[] = [
      { id: 1, name: "A", category: "saas", claimed: ["GREENHOUSE"], status: "confirmed", source: "GREENHOUSE", claimCorrect: true, requests: 1 },
      { id: 2, name: "B", category: "saas", claimed: ["GREENHOUSE"], status: "confirmed", source: "ASHBY", claimCorrect: false, requests: 5 },
      { id: 3, name: "C", category: "saas", claimed: ["EMPLY"], status: "exists-unsupported", source: "EMPLY", requests: 9 },
      { id: 4, name: "D", category: "saas", claimed: ["TEAMTAILOR"], status: "already-watched", requests: 0 },
    ];
    expect(summarize(results)).toEqual({
      byStatus: { confirmed: 2, "exists-unsupported": 1, "already-watched": 1 },
      bySource: { "confirmed:GREENHOUSE": 1, "confirmed:ASHBY": 1, "exists-unsupported:EMPLY": 1 },
      claimsChecked: 2,
      claimsCorrect: 1,
      requests: 15,
    });
  });
});
