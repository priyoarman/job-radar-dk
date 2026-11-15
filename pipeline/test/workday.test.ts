import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeJobs } from "../src/sources/normalize";
import {
  MAX_PAGES,
  PAGE_SIZE,
  PAUSE_MS,
  denmarkFacet,
  fetchDenmarkPostings,
  jobsEndpoint,
  parseSiteUrl,
  workdayAdapter,
} from "../src/sources/workday";

type ListResponse = { total: number; jobPostings: Record<string, unknown>[]; facets: unknown[] };

const fixture = (name: string): ListResponse =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/workday", name), "utf8"));

const SITE_URL = "https://maersk.wd3.myworkdayjobs.com/en-US/Maersk_Careers";
const company = { slug: "maersk", name: "Maersk", sourceKey: SITE_URL };
const page1 = () => fixture("maersk-denmark-page1.json");
const posting = (index: number) => page1().jobPostings[index]!;

function fakeHttp(...responses: unknown[]) {
  const json = vi.fn();
  for (const response of responses) json.mockResolvedValueOnce(response);
  return { text: vi.fn(), json };
}

function pageOf(count: number, total: number, startId = 0): ListResponse {
  const base = posting(0);
  const jobPostings = Array.from({ length: count }, (_, i) => ({
    ...base,
    externalPath: `/job/Denmark-Copenhagen/Job_R${startId + i}`,
    bulletFields: [`R${startId + i}`],
  }));
  return { total, jobPostings, facets: [] };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseSiteUrl", () => {
  it.each([
    ["https://maersk.wd3.myworkdayjobs.com/en-US/Maersk_Careers", "maersk.wd3.myworkdayjobs.com", "maersk", "Maersk_Careers"],
    ["https://maersk.wd3.myworkdayjobs.com/Maersk_Careers", "maersk.wd3.myworkdayjobs.com", "maersk", "Maersk_Careers"],
    ["https://workday.wd5.myworkdayjobs.com/Workday/", "workday.wd5.myworkdayjobs.com", "workday", "Workday"],
  ])("%s → %s / %s / %s", (url, host, tenant, site) => {
    expect(parseSiteUrl(url)).toEqual({ host, tenant, site });
  });

  it.each(["https://example.com/careers", "https://maersk.wd3.myworkdayjobs.com/", "not a url"])("rejects %s", (url) => {
    expect(() => parseSiteUrl(url)).toThrow();
  });

  it("builds the jobs endpoint", () => {
    expect(jobsEndpoint(parseSiteUrl(SITE_URL))).toBe("https://maersk.wd3.myworkdayjobs.com/wday/cxs/maersk/Maersk_Careers/jobs");
  });
});

describe("denmarkFacet", () => {
  it("finds Maersk's Danish office locations in its nested location filter", () => {
    const result = denmarkFacet(fixture("maersk-facets.json").facets);
    expect(result?.parameter).toBe("locations");
    expect(result?.ids).toHaveLength(8);
  });

  it("returns null when a company has no jobs in Denmark", () => {
    expect(denmarkFacet(fixture("workday-facets-no-denmark.json").facets)).toBeNull();
  });

  it("prefers a country filter when the company has one", () => {
    const facets = [
      { facetParameter: "Location_Country", values: [{ descriptor: "Denmark", id: "dk-country" }, { descriptor: "Sweden", id: "se" }] },
      { facetParameter: "locations", values: [{ descriptor: "Copenhagen", id: "cph-1" }, { descriptor: "Aarhus", id: "aar-1" }] },
    ];
    expect(denmarkFacet(facets)).toEqual({ parameter: "Location_Country", ids: ["dk-country"] });
  });
});

describe("workdayAdapter.fetchJobs", () => {
  it("asks for the filters first, then only Danish jobs, page by page", async () => {
    const http = fakeHttp(fixture("maersk-facets.json"), pageOf(20, 41, 0), pageOf(20, 41, 20), pageOf(1, 41, 40));
    const raws = await fetchDenmarkPostings(parseSiteUrl(SITE_URL), http, 0);
    expect(raws).toHaveLength(41);
    expect(http.json).toHaveBeenCalledTimes(4);
    const bodies = http.json.mock.calls.map(([, request]) => request.body);
    expect(bodies[0]).toEqual({ appliedFacets: {}, limit: 1, offset: 0, searchText: "" });
    expect(bodies.slice(1).map((b) => [Object.keys(b.appliedFacets), b.offset, b.limit])).toEqual([
      [["locations"], 0, 20],
      [["locations"], 20, 20],
      [["locations"], 40, 20],
    ]);
    for (const [url, request] of http.json.mock.calls) {
      expect(url).toBe("https://maersk.wd3.myworkdayjobs.com/wday/cxs/maersk/Maersk_Careers/jobs");
      expect(request.method).toBe("POST");
    }
  });

  it("stops after one request when the company has no Danish jobs", async () => {
    const http = fakeHttp(fixture("workday-facets-no-denmark.json"));
    const raws = await workdayAdapter.fetchJobs({ ...company, sourceKey: "https://workday.wd5.myworkdayjobs.com/Workday" }, http);
    expect(raws).toEqual([]);
    expect(http.json).toHaveBeenCalledTimes(1);
  });

  it(`never fetches more than ${MAX_PAGES} pages in one run`, async () => {
    const pages = Array.from({ length: MAX_PAGES + 5 }, (_, i) => pageOf(PAGE_SIZE, 10_000, i * PAGE_SIZE));
    const http = fakeHttp(fixture("maersk-facets.json"), ...pages);
    const raws = await fetchDenmarkPostings(parseSiteUrl(SITE_URL), http, 0);
    expect(raws).toHaveLength(MAX_PAGES * PAGE_SIZE);
    expect(http.json).toHaveBeenCalledTimes(1 + MAX_PAGES);
  });

  it(`pauses ${PAUSE_MS} ms before each page request, to stay under rate limits`, async () => {
    vi.useFakeTimers();
    try {
      const http = fakeHttp(fixture("maersk-facets.json"), pageOf(20, 41, 0), pageOf(20, 41, 20), pageOf(1, 41, 40));
      const promise = fetchDenmarkPostings(parseSiteUrl(SITE_URL), http);
      await vi.advanceTimersByTimeAsync(0);
      expect(http.json).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(PAUSE_MS - 1);
      expect(http.json).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(http.json).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(PAUSE_MS * 2);
      await expect(promise).resolves.toHaveLength(41);
      expect(http.json).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes a 429 from the site straight through, so the run records it and does not retry", async () => {
    const http = { text: vi.fn(), json: vi.fn().mockRejectedValue(Object.assign(new Error("POST … failed with HTTP 429"), { status: 429 })) };
    await expect(fetchDenmarkPostings(parseSiteUrl(SITE_URL), http, 0)).rejects.toThrow("HTTP 429");
    expect(http.json).toHaveBeenCalledTimes(1);
  });

  it("throws on a response that is not a job list", async () => {
    await expect(workdayAdapter.fetchJobs(company, fakeHttp({ error: "Not found" }))).rejects.toThrow("no jobPostings list");
  });
});

describe("workdayAdapter.normalize", () => {
  it("maps a real posting to a NormalizedJob, without a description", () => {
    const job = workdayAdapter.normalize(posting(4), company);
    expect(job).toEqual({
      externalId: "R197730",
      title: "Senior Software Engineer",
      company: "Maersk",
      location: "DKCPH55 - Copenhagen - Esplanaden 50",
      remoteType: null,
      description: "",
      url: "https://maersk.wd3.myworkdayjobs.com/Maersk_Careers/job/DKCPH55---Copenhagen---Esplanaden-50/Senior-Software-Engineer_R197730",
      postedAt: null,
    });
  });

  it.each([
    ["Denmark, Aarhus, 8210", "Denmark, Aarhus, 8210"],
    ["DK - Aarhus", "DK - Aarhus"],
    ["2 Locations", "Denmark (2 locations)"],
    ["Somewhere Unknown", "Somewhere Unknown, Denmark"],
    [null, "Denmark"],
  ])("formats locationsText %s → %s", (locationsText, expected) => {
    expect(workdayAdapter.normalize({ ...posting(0), locationsText }, company).location).toBe(expected);
  });

  it.each([
    ["Flex", "hybrid"],
    ["Remote", "remote"],
    ["Onsite", "onsite"],
    ["Site Based", "onsite"],
    [undefined, null],
  ])("maps remoteType %s → %s", (remoteType, expected) => {
    expect(workdayAdapter.normalize({ ...posting(0), remoteType }, company).remoteType).toBe(expected);
  });

  it("uses the path as id when there is no requisition id", () => {
    expect(workdayAdapter.normalize({ ...posting(0), bulletFields: [] }, company).externalId).toBe(posting(0).externalPath);
  });

  it("normalizes every posting on the real page", () => {
    const { jobs, skipped } = normalizeJobs(workdayAdapter, page1().jobPostings, company);
    expect(skipped).toBe(0);
    expect(jobs).toHaveLength(20);
  });

  it("skips a broken posting and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { title: _title, ...broken } = posting(1);
    const { jobs, skipped } = normalizeJobs(workdayAdapter, [posting(0), broken], company);
    expect(skipped).toBe(1);
    expect(jobs).toHaveLength(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/normalize\.skipped .*"source":"WORKDAY".*title/);
  });
});
