import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeJobs } from "../src/sources/normalize";
import {
  MAX_PAGES,
  PAUSE_MS,
  fetchDenmarkRows,
  parseSearchPage,
  searchUrl,
  siteOrigin,
  successFactorsAdapter,
} from "../src/sources/successfactors";

const html = (name: string) => readFileSync(resolve(import.meta.dirname, "fixtures/successfactors", name), "utf8");
const robots = () => html("robots-allowed.txt");
const novo = { slug: "novo-nordisk", name: "Novo Nordisk", sourceKey: "https://careers.novonordisk.com" };

function withBanner(page: string, first: number, last: number, total: number) {
  return page.replace(/Results\s*<b>[^<]*<\/b>\s*of\s*<b>[^<]*<\/b>/, `Results <b>${first} – ${last}</b> of <b>${total}</b>`);
}

function fakeHttp(...pages: string[]) {
  const text = vi.fn();
  for (const page of pages) text.mockResolvedValueOnce(page);
  return { text, json: vi.fn() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("urls", () => {
  it("uses only the origin of the careers URL", () => {
    expect(siteOrigin("https://careers.novonordisk.com/")).toBe("https://careers.novonordisk.com");
    expect(siteOrigin("https://careers.novonordisk.com/go/Denmark/123/")).toBe("https://careers.novonordisk.com");
  });

  it("searches for Denmark, with startrow only after the first page", () => {
    expect(searchUrl("https://jobs.dsv.com", 0)).toBe("https://jobs.dsv.com/search/?q=&locationsearch=Denmark");
    expect(searchUrl("https://jobs.dsv.com", 10)).toBe("https://jobs.dsv.com/search/?q=&locationsearch=Denmark&startrow=10");
  });
});

describe("parseSearchPage", () => {
  it.each([
    ["novonordisk-denmark.html", 79, 79, 79],
    ["vestas-denmark-page1.html", 10, 10, 65],
    ["dsv-denmark-page1.html", 10, 10, 17],
  ])("reads every row and the results banner of %s", (name, rows, last, total) => {
    const page = parseSearchPage(html(name));
    expect(page.rows).toHaveLength(rows);
    expect(page).toMatchObject({ last, total });
  });

  it("reads title, link, location and date from a real row", () => {
    expect(parseSearchPage(html("novonordisk-denmark.html")).rows[0]).toEqual({
      title: "Full-Stack Cloud Developer",
      path: "/job/Ballerup-Full-Stack-Cloud-Developer-Capi/1454132133/",
      location: "Ballerup, Capital Region of Denmark, DK",
      date: "4 Nov 2026",
    });
  });

  it("drops the '+9 more…' note from multi-location jobs", () => {
    expect(parseSearchPage(html("vestas-denmark-page1.html")).rows[0]?.location).toBe("Aarhus C, Region Central Jutland, DK");
  });

  it("finds the date even on sites without a date column", () => {
    expect(parseSearchPage(html("vestas-denmark-page1.html")).rows.every((r) => r.date !== null)).toBe(true);
  });

  it("finds nothing on the newer, JavaScript-rendered search page", () => {
    expect(parseSearchPage(html("grundfos-new-search-page.html"))).toEqual({ rows: [], last: null, total: null });
  });
});

describe("fetchDenmarkRows", () => {
  it("checks robots.txt first, then reads one page when everything fits on it", async () => {
    const http = fakeHttp(robots(), html("novonordisk-denmark.html"));
    const rows = await fetchDenmarkRows("https://careers.novonordisk.com", http, 0);
    expect(rows).toHaveLength(79);
    expect(http.text.mock.calls.map(([url]) => url)).toEqual([
      "https://careers.novonordisk.com/robots.txt",
      "https://careers.novonordisk.com/search/?q=&locationsearch=Denmark",
    ]);
  });

  it("follows the results banner to the next pages", async () => {
    const page1 = html("dsv-denmark-page1.html");
    const http = fakeHttp(robots(), page1, withBanner(page1, 11, 17, 17));
    const rows = await fetchDenmarkRows("https://jobs.dsv.com", http, 0);
    expect(rows).toHaveLength(20);
    expect(http.text.mock.calls.map(([url]) => url).at(-1)).toBe("https://jobs.dsv.com/search/?q=&locationsearch=Denmark&startrow=10");
  });

  it(`pauses ${PAUSE_MS} ms between pages`, async () => {
    vi.useFakeTimers();
    try {
      const page1 = html("dsv-denmark-page1.html");
      const http = fakeHttp(robots(), page1, withBanner(page1, 11, 17, 17));
      const promise = fetchDenmarkRows("https://jobs.dsv.com", http);
      await vi.advanceTimersByTimeAsync(0);
      expect(http.text).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(PAUSE_MS);
      await expect(promise).resolves.toHaveLength(20);
      expect(http.text).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it(`never reads more than ${MAX_PAGES} pages`, async () => {
    const page1 = withBanner(html("dsv-denmark-page1.html"), 1, 10, 10_000);
    const pages = Array.from({ length: MAX_PAGES + 3 }, (_, i) => withBanner(page1, i * 10 + 1, i * 10 + 10, 10_000));
    const http = fakeHttp(robots(), ...pages);
    await fetchDenmarkRows("https://jobs.dsv.com", http, 0);
    expect(http.text).toHaveBeenCalledTimes(1 + MAX_PAGES);
  });

  it("stops before searching when robots.txt forbids the search page", async () => {
    const http = fakeHttp("User-agent: *\nDisallow: /search/");
    await expect(fetchDenmarkRows("https://jobs.dsv.com", http, 0)).rejects.toThrow("robots-disallowed");
    expect(http.text).toHaveBeenCalledTimes(1);
  });

  it("fails clearly on a site with the newer search page instead of reporting 0 jobs", async () => {
    const http = fakeHttp(robots(), html("grundfos-new-search-page.html"));
    await expect(fetchDenmarkRows("https://jobs.grundfos.com", http, 0)).rejects.toThrow("newer search page");
  });
});

describe("successFactorsAdapter.normalize", () => {
  const rows = () => parseSearchPage(html("novonordisk-denmark.html")).rows;

  it("maps a real row to a NormalizedJob", () => {
    expect(successFactorsAdapter.normalize(rows()[0], novo)).toEqual({
      externalId: "1454132133",
      title: "Full-Stack Cloud Developer",
      company: "Novo Nordisk",
      location: "Ballerup, Capital Region of Denmark, DK",
      remoteType: null,
      description: "",
      url: "https://careers.novonordisk.com/job/Ballerup-Full-Stack-Cloud-Developer-Capi/1454132133/",
      postedAt: new Date("2026-11-04T00:00:00Z"),
    });
  });

  it("keeps encoded characters in the link", () => {
    const row = rows().find((r) => r.title === "AI Search Specialist")!;
    expect(successFactorsAdapter.normalize(row, novo).url).toBe(
      "https://careers.novonordisk.com/job/%C3%98restad-AI-Search-Specialist-Capi/1455804333/",
    );
  });

  it("uses the path as id when it has no number, and null for an unreadable date", () => {
    const job = successFactorsAdapter.normalize({ ...rows()[0], path: "/job/some-job/", date: "soon" }, novo);
    expect(job.externalId).toBe("/job/some-job/");
    expect(job.postedAt).toBeNull();
  });

  it("normalizes every row on all three real pages", () => {
    for (const name of ["novonordisk-denmark.html", "vestas-denmark-page1.html", "dsv-denmark-page1.html"]) {
      const pageRows = parseSearchPage(html(name)).rows;
      const { jobs, skipped } = normalizeJobs(successFactorsAdapter, pageRows, novo);
      expect(skipped).toBe(0);
      expect(new Set(jobs.map((j) => j.externalId)).size).toBe(pageRows.length);
    }
  });

  it("skips a broken row and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { title: _title, ...broken } = rows()[1]!;
    const { jobs, skipped } = normalizeJobs(successFactorsAdapter, [rows()[0], broken], novo);
    expect(skipped).toBe(1);
    expect(jobs).toHaveLength(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/normalize\.skipped .*"source":"SUCCESSFACTORS".*title/);
  });
});
