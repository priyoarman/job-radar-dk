import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { normalizeJobs } from "../src/sources/normalize";
import { THEHUB_MAX_PAGES, apiUrl, detailUrl, parseTheHubPage, theHubAdapter } from "../src/sources/thehub";

const page = (n: number): unknown =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, `fixtures/thehub/typescript-dk-page${n}.json`), "utf8"));

const SEARCH_URL = "https://thehub.io/jobs?search=typescript&countryCode=DK&sorting=newJobs";
const company = { slug: "thehub-typescript", name: "The Hub", sourceKey: SEARCH_URL };
const allRaws = [1, 2, 3].flatMap((n) => parseTheHubPage(page(n)).jobs);

const detail = (id: string) => ({
  doc: { id, publishedAt: "2026-10-26T09:14:05.345Z", description: "<h4>Title</h4><p>We build <b>TypeScript</b> things.</p>" },
});

function fakeHttp(pageFor: (n: number) => unknown, detailFor: (id: string) => unknown = detail) {
  return {
    text: vi.fn().mockResolvedValue("User-agent: *\nDisallow: /startups/joblistwidget/"),
    json: vi.fn(async (url: string) => {
      const detailMatch = /\/api\/jobs\/([^/?]+)$/.exec(new URL(url).pathname);
      if (detailMatch) return detailFor(detailMatch[1]!);
      return pageFor(Number(new URL(url).searchParams.get("page")));
    }),
  };
}

const listCalls = (http: ReturnType<typeof fakeHttp>) =>
  http.json.mock.calls.map(([url]) => url).filter((url) => url.includes("jobsandfeatured"));

describe("apiUrl", () => {
  it("turns the search link into the JSON API behind the page", () => {
    expect(apiUrl(SEARCH_URL, 2)).toBe(
      "https://thehub.io/api/v2/jobsandfeatured?search=typescript&countryCode=DK&sorting=newJobs&page=2",
    );
  });

  it("drops parameters the API does not need", () => {
    expect(apiUrl("https://thehub.io/jobs?search=react&utm_source=x", 1)).toBe(
      "https://thehub.io/api/v2/jobsandfeatured?search=react&page=1",
    );
  });
});

describe("parseTheHubPage", () => {
  it("reads the jobs and the page count", () => {
    const { pages, jobs } = parseTheHubPage(page(1));
    expect(pages).toBe(3);
    expect(jobs).toHaveLength(15);
  });

  it.each([{ error: "x" }, [], "<html>", null])("throws on a response that is not a job list: %j", (data) => {
    expect(() => parseTheHubPage(data)).toThrow("no jobs list");
  });
});

describe("detailUrl", () => {
  it("points at the job's own API entry", () => {
    expect(detailUrl(SEARCH_URL, "6adf190afe5ce0d913bf032f")).toBe("https://thehub.io/api/jobs/6adf190afe5ce0d913bf032f");
  });
});

describe("theHubAdapter.fetchJobs", () => {
  it("reads every page of the search, once each", async () => {
    const http = fakeHttp(page);
    const raws = await theHubAdapter.fetchJobs(company, http);
    expect(listCalls(http).map((url) => new URL(url).searchParams.get("page"))).toEqual(["1", "2", "3"]);
    expect(raws).toHaveLength(37);
  });

  it("reads each job's details for its publish time and description", async () => {
    const http = fakeHttp(page);
    const raws = await theHubAdapter.fetchJobs(company, http);
    const job = theHubAdapter.normalize(raws[0], company);
    expect(job.postedAt).toEqual(new Date("2026-10-26T09:14:05.345Z"));
    expect(job.description).toBe("Title\nWe build TypeScript things.");
    expect(http.json).toHaveBeenCalledTimes(3 + 37);
  });

  it("keeps a job without details when its detail request fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const http = fakeHttp(page, () => {
      throw new Error("HTTP 500");
    });
    const raws = await theHubAdapter.fetchJobs(company, http);
    expect(raws).toHaveLength(37);
    expect(theHubAdapter.normalize(raws[0], company).postedAt).toBeNull();
    expect(String(warn.mock.calls[0]?.[0])).toContain("thehub.detail-failed");
    warn.mockRestore();
  });

  it("stops after the page cap even if the API reports more pages", async () => {
    const http = fakeHttp(() => ({ jobs: { pages: 99, docs: [] } }));
    await theHubAdapter.fetchJobs(company, http);
    expect(listCalls(http)).toHaveLength(THEHUB_MAX_PAGES);
  });
});

describe("theHubAdapter.normalize", () => {
  it("keeps the employer and links to the job page", () => {
    expect(theHubAdapter.normalize(allRaws[1], company)).toEqual({
      externalId: expect.stringMatching(/^[a-f0-9]{24}$/),
      title: "Fullstack Engineer - CPH",
      company: "Lunar",
      location: "Copenhagen, Denmark",
      remoteType: null,
      description: "",
      url: expect.stringMatching(/^https:\/\/thehub\.io\/jobs\/[a-f0-9]{24}$/),
      postedAt: null,
    });
  });

  it("marks remote jobs", () => {
    expect(theHubAdapter.normalize({ ...(allRaws[0] as object), isRemote: true }, company).remoteType).toBe("remote");
  });

  it("normalizes every job in the real search, with no duplicates", () => {
    const { jobs, skipped } = normalizeJobs(theHubAdapter, allRaws, company);
    expect(skipped).toBe(0);
    expect(new Set(jobs.map((j) => j.externalId)).size).toBe(37);
    for (const job of jobs) expect(job.company).not.toBe("The Hub");
  });
});
