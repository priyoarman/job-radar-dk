import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isPathAllowed } from "../src/lib/robots";
import { jobindexAdapter, jobindexSearch, parseJobindexFeed, withinAge } from "../src/sources/jobindex";
import { normalizeJobs } from "../src/sources/normalize";

const xml = readFileSync(resolve(import.meta.dirname, "fixtures/jobindex/react-typescript.xml"), "utf8");
const raws = parseJobindexFeed(xml);

const SEARCH_URL = "https://www.jobindex.dk/jobsoegning?jobage=7&q=react+typescript";
const FEED_URL = "https://www.jobindex.dk/jobsoegning.rss?q=react+typescript";
const company = { slug: "jobindex-react-typescript", name: "Jobindex", sourceKey: SEARCH_URL };

const ROBOTS = [
  "User-agent: *",
  "Disallow: /jobsoegning*page=",
  "Disallow: /jobsoegning*jobage=",
  "Disallow: /jobsoegning?*&*&",
  "Disallow: /jobsoegning*?*+*+",
].join("\n");

describe("jobindexSearch", () => {
  it("turns the search link into the official RSS feed plus an age limit", () => {
    expect(jobindexSearch(SEARCH_URL)).toEqual({ feedUrl: FEED_URL, maxAgeDays: 7 });
  });

  it("builds a feed URL that Jobindex's robots.txt allows, unlike the original link", () => {
    expect(isPathAllowed(ROBOTS, "/jobsoegning?jobage=7&q=react+typescript")).toBe(false);
    expect(isPathAllowed(ROBOTS, "/jobsoegning.rss?q=react+typescript")).toBe(true);
  });

  it("has no age limit when the link has no jobage", () => {
    expect(jobindexSearch("https://www.jobindex.dk/jobsoegning?q=react").maxAgeDays).toBeNull();
  });

  it("refuses a link without search words", () => {
    expect(() => jobindexSearch("https://www.jobindex.dk/jobsoegning?jobage=7")).toThrow("no q=");
  });
});

describe("parseJobindexFeed", () => {
  it("finds all 20 jobs in the real feed", () => {
    expect(raws).toHaveLength(20);
  });

  it("reads an empty feed as no jobs", () => {
    expect(parseJobindexFeed('<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>')).toEqual([]);
  });

  it.each(["<html><body>Error</body></html>", "not xml <"])("throws on a document that is not the feed: %s", (doc) => {
    expect(() => parseJobindexFeed(doc)).toThrow(/Jobindex feed/);
  });
});

describe("withinAge", () => {
  const now = new Date("2026-11-20T22:00:00Z");

  it("keeps only jobs from the last 7 days, like jobage=7", () => {
    const kept = withinAge(raws, 7, now).map((raw) => (raw as { pubDate: string }).pubDate);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(raws.length);
    expect(kept).toContain("Fri, 13 Nov 2026 00:00:00 +0100");
    expect(kept).not.toContain("Thu, 12 Nov 2026 00:00:00 +0100");
  });

  it("keeps everything when there is no age limit", () => {
    expect(withinAge(raws, null, now)).toHaveLength(20);
  });
});

describe("jobindexAdapter.fetchJobs", () => {
  it("checks robots.txt, then reads the RSS feed once", async () => {
    const http = {
      text: vi.fn(async (url: string) => (url.endsWith("/robots.txt") ? ROBOTS : xml)),
      json: vi.fn(),
    };
    const result = await jobindexAdapter.fetchJobs(company, http);
    expect(http.text.mock.calls.map(([url]) => url)).toEqual(["https://www.jobindex.dk/robots.txt", FEED_URL]);
    expect(result.length).toBeLessThanOrEqual(20);
  });
});

describe("jobindexAdapter.normalize", () => {
  it("splits the employer from the title and reads the place", () => {
    const job = jobindexAdapter.normalize(raws[1], company);
    expect(job).toMatchObject({
      externalId: "1718265",
      title: "Frontend Software Developer",
      company: "XCI A/S",
      location: "Aalborg Øst",
      remoteType: null,
      url: "https://www.jobindex.dk/vis-job/h1718265",
      postedAt: new Date("2026-11-19T23:00:00Z"),
    });
    expect(job.description).toMatch(/^Join a rapidly growing technology company/);
    expect(job.description).not.toContain("Frontend Software Developer");
  });

  it("keeps an employer name that has a comma in it", () => {
    const job = jobindexAdapter.normalize(raws[3], company);
    expect(job.title).toBe("Part-time web developer (React/Django) for bioinformatic web tools - DTU Food");
    expect(job.company).toBe("DTU, Danmarks Tekniske Universitet");
  });

  it("normalizes every job in the real feed", () => {
    const { jobs, skipped } = normalizeJobs(jobindexAdapter, raws, company);
    expect(skipped).toBe(0);
    expect(jobs).toHaveLength(20);
    for (const job of jobs) expect(job.company).not.toBe("Jobindex");
  });
});
