import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../src/lib/http";
import {
  MAX_JOBS,
  PAUSE_MS,
  customAdapter,
  fetchCareerPages,
  findJobPosting,
  jobLinks,
  parseJobPage,
} from "../src/sources/custom";
import { normalizeJobs } from "../src/sources/normalize";

const fixture = (name: string) => readFileSync(resolve(import.meta.dirname, "fixtures/custom", name), "utf8");
const LIST = "https://jppol.dk/karriere/";
const FULLSTACK = "https://jppol.dk/jobs/fullstack-udvikler-til-redaktionel-analyseplatform/";
const jppol = { slug: "jppol", name: "JP/Politikens Hus", sourceKey: LIST };

const page = (links: string[]) => `<html><body>${links.map((l) => `<a href="${l}">job</a>`).join("")}</body></html>`;

function fakeHttp(pages: Record<string, string | Error>) {
  const text = vi.fn(async (url: string) => {
    const result = pages[url];
    if (result === undefined) throw new Error(`unexpected request to ${url}`);
    if (result instanceof Error) throw result;
    return result;
  });
  return { text, json: vi.fn() };
}

const robots = { "https://jppol.dk/robots.txt": fixture("jppol-robots.txt") };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("jobLinks", () => {
  it("finds the 12 job links on JP/Pol's career page", () => {
    const links = jobLinks(fixture("jppol-karriere.html"), LIST);
    expect(links).toHaveLength(12);
    expect(links).toContain(FULLSTACK);
    expect(links.every((l) => l.startsWith("https://jppol.dk/jobs/"))).toBe(true);
  });

  it("keeps same-site links with a job folder followed by a job name", () => {
    const html = page([
      "/jobs/backend-developer/",
      "/da/ledige-stillinger/udvikler-123",
      "https://example.com/vacancies/42?ref=list",
      "/jobs/",
      "/karriere/studerende/",
      "https://other.com/jobs/x/",
      "mailto:jobs@example.com",
      "/jobs/backend-developer/#apply",
    ]);
    expect(jobLinks(html, "https://example.com/karriere/")).toEqual([
      "https://example.com/jobs/backend-developer/",
      "https://example.com/da/ledige-stillinger/udvikler-123",
      "https://example.com/vacancies/42?ref=list",
    ]);
  });

  it(`never returns more than ${MAX_JOBS} links`, () => {
    const html = page(Array.from({ length: MAX_JOBS + 5 }, (_, i) => `/jobs/job-${i}/`));
    expect(jobLinks(html, "https://example.com/karriere/")).toHaveLength(MAX_JOBS);
  });
});

describe("parseJobPage", () => {
  it("reads title, place, date and description from JobPosting JSON-LD", () => {
    const job = parseJobPage(fixture("teamtailor-jobposting.html"));
    expect(job).toMatchObject({
      title: "Software Developer - Mainframe/Cobol",
      location: "Aarhus, DK",
      remoteType: null,
      postedAt: new Date("2026-08-21T14:04:01+02:00"),
    });
    expect(job.description).toMatch(/^Build and maintain Denmark's leading payroll system/);
    expect(job.description).not.toMatch(/<[a-z]/i);
  });

  it("falls back to the heading and main text when there is no JSON-LD", () => {
    const job = parseJobPage(fixture("jppol-job-fullstack.html"));
    expect(job).toMatchObject({
      title: "Fullstack-udvikler til redaktionel analyseplatform",
      location: null,
      remoteType: null,
      postedAt: null,
    });
    expect(job.description).toMatch(/^Vil du have teknisk ansvar for en central analyseplatform/);
    expect(job.description).toContain("Ansøgningsfrist 1. december 2026");
    expect(job.description).not.toContain("Privatlivspolitik");
  });

  it("finds a JobPosting inside @graph, with several places and a remote flag", () => {
    const ld = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", name: "x" },
        {
          "@type": ["JobPosting"],
          title: "Frontend Developer",
          description: "&lt;p&gt;Build &lt;b&gt;things&lt;/b&gt;&lt;/p&gt;",
          datePosted: "2026-11-01",
          jobLocationType: "TELECOMMUTE",
          jobLocation: [
            { "@type": "Place", address: { addressLocality: "Copenhagen", addressCountry: { name: "Denmark" } } },
            { "@type": "Place", address: "Aarhus" },
          ],
        },
      ],
    };
    const html = `<script type="application/ld+json">not json</script><script type="application/ld+json">${JSON.stringify(ld)}</script>`;
    expect(parseJobPage(html)).toEqual({
      title: "Frontend Developer",
      location: "Copenhagen, Denmark; Aarhus",
      remoteType: "remote",
      description: "Build things",
      postedAt: new Date("2026-11-01T00:00:00Z"),
    });
  });

  it("ignores JSON-LD that is not a JobPosting", () => {
    expect(findJobPosting('<script type="application/ld+json">{"@type":"Organization"}</script>')).toBeNull();
  });
});

describe("fetchCareerPages", () => {
  it("checks robots.txt, reads the list page, then each job page", async () => {
    const links = jobLinks(fixture("jppol-karriere.html"), LIST);
    const http = fakeHttp({
      ...robots,
      [LIST]: fixture("jppol-karriere.html"),
      ...Object.fromEntries(links.map((l) => [l, fixture("jppol-job-fullstack.html")])),
    });
    const pages = await fetchCareerPages(LIST, http, 0);
    expect(pages.map((p) => p.url)).toEqual(links);
    expect(http.text.mock.calls.map(([url]) => url).slice(0, 3)).toEqual(["https://jppol.dk/robots.txt", LIST, links[0]]);
    expect(http.text).toHaveBeenCalledTimes(2 + links.length);
  });

  it("returns nothing when the list page has no job links", async () => {
    const http = fakeHttp({ ...robots, [LIST]: "<html><body>Ingen ledige stillinger</body></html>" });
    await expect(fetchCareerPages(LIST, http, 0)).resolves.toEqual([]);
  });

  it("skips a job page that is gone or blocked, and keeps the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const http = fakeHttp({
      "https://jppol.dk/robots.txt": "User-agent: *\nDisallow: /jobs/secret/",
      [LIST]: page(["/jobs/ok/", "/jobs/gone/", "/jobs/secret/x/"]),
      "https://jppol.dk/jobs/ok/": "<h1>OK</h1>",
      "https://jppol.dk/jobs/gone/": new HttpError("https://jppol.dk/jobs/gone/", 404),
    });
    const pages = await fetchCareerPages(LIST, http, 0);
    expect(pages.map((p) => p.url)).toEqual(["https://jppol.dk/jobs/ok/"]);
    expect(warn.mock.calls.map(([line]) => String(line))).toEqual([
      expect.stringMatching(/custom\.job-skipped .*jobs\/gone.*404/),
      expect.stringMatching(/custom\.job-skipped .*robots-disallowed/),
    ]);
  });

  it("fails the whole fetch on any other error, so open jobs are not closed by mistake", async () => {
    const http = fakeHttp({
      ...robots,
      [LIST]: page(["/jobs/ok/", "/jobs/down/"]),
      "https://jppol.dk/jobs/ok/": "<h1>OK</h1>",
      "https://jppol.dk/jobs/down/": new HttpError("https://jppol.dk/jobs/down/", 503),
    });
    await expect(fetchCareerPages(LIST, http, 0)).rejects.toThrow("503");
  });

  it("stops before reading anything when robots.txt blocks the list page", async () => {
    const http = fakeHttp({ "https://jppol.dk/robots.txt": "User-agent: *\nDisallow: /karriere/" });
    await expect(fetchCareerPages(LIST, http, 0)).rejects.toThrow("robots-disallowed");
    expect(http.text).toHaveBeenCalledTimes(1);
  });

  it(`pauses ${PAUSE_MS} ms before each job page`, async () => {
    vi.useFakeTimers();
    try {
      const http = fakeHttp({ ...robots, [LIST]: page(["/jobs/a/", "/jobs/b/"]), "https://jppol.dk/jobs/a/": "<h1>A</h1>", "https://jppol.dk/jobs/b/": "<h1>B</h1>" });
      const promise = fetchCareerPages(LIST, http);
      await vi.advanceTimersByTimeAsync(0);
      expect(http.text).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(PAUSE_MS);
      expect(http.text).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(PAUSE_MS);
      await expect(promise).resolves.toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("customAdapter.normalize", () => {
  it("maps a real JP/Pol job page, using its URL as the id", () => {
    const job = customAdapter.normalize({ url: FULLSTACK, html: fixture("jppol-job-fullstack.html") }, jppol);
    expect(job).toMatchObject({
      externalId: FULLSTACK,
      title: "Fullstack-udvikler til redaktionel analyseplatform",
      company: "JP/Politikens Hus",
      url: FULLSTACK,
    });
  });

  it("matches the snapshot for the JSON-LD page", () => {
    const url = "https://careers.egsoftware.com/jobs/8254011-software-developer-mainframe-cobol";
    expect(customAdapter.normalize({ url, html: fixture("teamtailor-jobposting.html") }, jppol)).toMatchSnapshot();
  });

  it("skips a page without a title and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { jobs, skipped } = normalizeJobs(
      customAdapter,
      [
        { url: FULLSTACK, html: fixture("jppol-job-fullstack.html") },
        { url: "https://jppol.dk/jobs/empty/", html: "<html><body><p>nothing</p></body></html>" },
      ],
      jppol,
    );
    expect(skipped).toBe(1);
    expect(jobs).toHaveLength(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/normalize\.skipped .*"source":"CUSTOM".*title/);
  });
});
