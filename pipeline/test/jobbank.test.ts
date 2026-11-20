import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isPathAllowed } from "../src/lib/robots";
import {
  JOBBANK_FEED_LIMIT,
  danishDate,
  feedUrl,
  jobbankAdapter,
  parseJobbankFeed,
  splitDescription,
} from "../src/sources/jobbank";
import { normalizeJobs } from "../src/sources/normalize";
import { filterSearchJob } from "../src/steps/filter";

const xml = readFileSync(resolve(import.meta.dirname, "fixtures/jobbank/react-typescript-since-19-11.xml"), "utf8");
const raws = parseJobbankFeed(xml);

const SEARCH_URL = "https://jobbank.dk/job/?key=react+typescript&antikey=&virk=&oprettet=";
const company = { slug: "jobbank-react-typescript", name: "Jobbank", sourceKey: SEARCH_URL };
const now = new Date("2026-11-21T10:00:00Z");

const ROBOTS = "User-agent: *\nDisallow: /job-arkiv/\nDisallow: /fwd/webjob/\nAllow: /job/";

const byTitle = (title: string) => raws.find((raw) => (raw as { title: string }).title === title);

describe("feedUrl", () => {
  it("turns the search link into the RSS feed for jobs created in the last 7 days", () => {
    expect(feedUrl(SEARCH_URL, now)).toBe("https://jobbank.dk/job/rss/?key=react+typescript&oprettet=14.11.2026");
  });

  it("keeps a created-since date that is already in the link", () => {
    expect(feedUrl("https://jobbank.dk/job/?key=react&oprettet=01.11.2026", now)).toBe(
      "https://jobbank.dk/job/rss/?key=react&oprettet=01.11.2026",
    );
  });

  it("keeps the other search fields when they are filled in", () => {
    expect(feedUrl("https://jobbank.dk/job/?key=react&antikey=senior&virk=123", now)).toBe(
      "https://jobbank.dk/job/rss/?key=react&antikey=senior&virk=123&oprettet=14.11.2026",
    );
  });

  it("refuses a link without search words", () => {
    expect(() => feedUrl("https://jobbank.dk/job/?key=&oprettet=", now)).toThrow("no key=");
  });

  it("asks for a path that Jobbank's robots.txt allows", () => {
    const { pathname, search } = new URL(feedUrl(SEARCH_URL, now));
    expect(isPathAllowed(ROBOTS, `${pathname}${search}`)).toBe(true);
  });
});

describe("danishDate", () => {
  it("uses the Danish calendar day, even late in the evening UTC", () => {
    expect(danishDate(new Date("2026-11-20T23:30:00Z"))).toBe("21.11.2026");
  });
});

describe("parseJobbankFeed", () => {
  it("finds every job in the real feed", () => {
    expect(raws).toHaveLength(25);
  });

  it.each(["<html>Document Moved</html>", "not xml <"])("throws on a document that is not the feed: %s", (doc) => {
    expect(() => parseJobbankFeed(doc)).toThrow(/Jobbank feed/);
  });
});

describe("splitDescription", () => {
  it.each([
    ["Fuldtidsjob hos Terma A/S, Østjylland (Aarhus) (Ansøgningsfrist: løbende)", "Terma A/S", ["Østjylland (Aarhus)"]],
    [
      "Studiejob hos PwC - Revision | Skat | Rådgivning, Storkøbenhavn, Øresundsregionen (Ansøgningsfrist: 05.12.2026)",
      "PwC - Revision | Skat | Rådgivning",
      ["Storkøbenhavn", "Øresundsregionen"],
    ],
    [
      "Fuldtidsjob, Vikariat hos Klima-, Energi- og Forsyningsministeriet, Storkøbenhavn (Ansøgningsfrist: 01.12.2026)",
      "Klima-, Energi- og Forsyningsministeriet",
      ["Storkøbenhavn"],
    ],
    ["Fuldtidsjob hos Halliburton Denmark Aps, Udlandet (Norge) (Ansøgningsfrist: løbende)", "Halliburton Denmark Aps", ["Udlandet (Norge)"]],
    ["Fuldtidsjob hos Example, Sydsjælland & Øer, Sydvestjylland (Esbjerg)", "Example", ["Sydsjælland & Øer", "Sydvestjylland (Esbjerg)"]],
  ])("splits %s", (description, employer, places) => {
    expect(splitDescription(description)).toEqual({ employer, places });
  });

  it("gives up cleanly on an unknown format", () => {
    expect(splitDescription("Something else")).toEqual({ employer: null, places: [] });
  });
});

describe("jobbankAdapter.fetchJobs", () => {
  it("checks robots.txt, then reads the feed once", async () => {
    const http = { text: vi.fn(async (url: string) => (url.endsWith("/robots.txt") ? ROBOTS : xml)), json: vi.fn() };
    const result = await jobbankAdapter.fetchJobs(company, http);
    const urls = http.text.mock.calls.map(([url]) => url);
    expect(urls[0]).toBe("https://jobbank.dk/robots.txt");
    expect(urls[1]).toMatch(/^https:\/\/jobbank\.dk\/job\/rss\/\?key=react\+typescript&oprettet=\d{2}\.\d{2}\.\d{4}$/);
    expect(result).toHaveLength(25);
  });

  it("warns when the feed is full, because jobs may be missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const item = "<item><title>T</title><link>https://jobbank.dk/job/1/x/y</link></item>";
    const full = `<rss><channel>${item.repeat(JOBBANK_FEED_LIMIT)}</channel></rss>`;
    const http = { text: vi.fn(async (url: string) => (url.endsWith("/robots.txt") ? ROBOTS : full)), json: vi.fn() };
    await jobbankAdapter.fetchJobs(company, http);
    expect(String(warn.mock.calls[0]?.[0])).toContain("jobbank.feed-full");
    warn.mockRestore();
  });
});

describe("jobbankAdapter.normalize", () => {
  it("reads the employer, places and job id", () => {
    expect(jobbankAdapter.normalize(byTitle("Full-stack Software Engineer, Lystrup"), company)).toEqual({
      externalId: expect.stringMatching(/^\d+$/),
      title: "Full-stack Software Engineer, Lystrup",
      company: "Terma A/S",
      location: "Østjylland (Aarhus)",
      remoteType: null,
      description: "Fuldtidsjob hos Terma A/S, Østjylland (Aarhus) (Ansøgningsfrist: løbende)",
      url: expect.stringMatching(/^https:\/\/jobbank\.dk\/job\/\d+\//),
      postedAt: new Date("2026-11-19T23:00:00Z"),
    });
  });

  it("normalizes every job in the real feed with a real employer", () => {
    const { jobs, skipped } = normalizeJobs(jobbankAdapter, raws, company);
    expect(skipped).toBe(0);
    expect(jobs).toHaveLength(25);
    for (const job of jobs) expect(job.company).not.toBe("Jobbank");
  });

  it("drops the abroad-only jobs but keeps Danish and mixed ones", () => {
    const { jobs } = normalizeJobs(jobbankAdapter, raws, company);
    const kept = jobs.filter((job) => filterSearchJob(job).pass);
    const dropped = jobs.filter((job) => !filterSearchJob(job).pass);
    expect(dropped.map((j) => j.location)).toEqual(
      expect.arrayContaining(["Udlandet (Norge)", "Udlandet (Sverige)", "Udlandet (øvrige)"]),
    );
    expect(kept.map((j) => j.location)).toEqual(
      expect.arrayContaining(["Storkøbenhavn", "Østjylland (Aarhus); Udlandet (Sverige)", "Fyn; Udlandet (øvrige)"]),
    );
  });
});
