import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeJobs } from "../src/sources/normalize";
import {
  type EmplyJob,
  MAX_PAGES,
  PAGE_SIZE,
  PAUSE_MS,
  emplyAdapter,
  fetchVacancies,
  pageBody,
  pageEndpoint,
  parseListingSettings,
} from "../src/sources/emply";

const fixture = (name: string) => readFileSync(resolve(import.meta.dirname, "fixtures/emply", name), "utf8");
const robots = () => fixture("robots-allowed.txt");
const matasVacancies = () => JSON.parse(fixture("matas-vacancies.json")) as { vacancies: Record<string, unknown>[]; count: number };
const MATAS_URL = "https://matas.career.emply.com/ledige-stillinger";
const matas = { slug: "matas", name: "Matas", sourceKey: MATAS_URL };

function fakeHttp(texts: string[], pages: unknown[]) {
  const text = vi.fn();
  for (const t of texts) text.mockResolvedValueOnce(t);
  const json = vi.fn();
  for (const p of pages) json.mockResolvedValueOnce(p);
  return { text, json };
}

const page = (vacancies: unknown[], count: number) => ({ vacancies, count });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseListingSettings", () => {
  it("reads section, language, sort and job link path from the Matas page", () => {
    expect(parseListingSettings(fixture("matas-listing.html"), MATAS_URL)).toEqual({
      sectionId: "7f01234c-998d-4ae1-9150-6c921236b9e9",
      langCode: "da-DK",
      sortBy: "project_number",
      adPath: "/ad/",
    });
  });

  it("keeps a language prefix in the job link path, as on EG's page", () => {
    expect(parseListingSettings(fixture("eg-listing.html"), "https://eg.career.emply.com/da/ledige-stillinger")).toEqual({
      sectionId: "20d13f8e-42bd-45b0-b040-416017313059",
      langCode: "da-DK",
      sortBy: "",
      adPath: "/da/ad/",
    });
  });

  it("fails clearly on a page without a job list instead of reporting 0 jobs", () => {
    expect(() => parseListingSettings("<html><body>Forside</body></html>", "https://x.career.emply.com/forside")).toThrow(
      "No Emply job list on https://x.career.emply.com/forside",
    );
  });
});

describe("pageBody", () => {
  it("asks for one page of jobs in the page's own section, language and sort", () => {
    const settings = parseListingSettings(fixture("matas-listing.html"), MATAS_URL);
    expect(pageBody(settings, 50)).toMatchObject({
      count: PAGE_SIZE,
      offset: 50,
      sectionId: "7f01234c-998d-4ae1-9150-6c921236b9e9",
      langCode: "da-DK",
      sortByProjectDataId: "project_number",
      filters: [],
      searchText: "",
    });
  });
});

describe("fetchVacancies", () => {
  it("checks robots.txt, reads the listing page, then posts for the jobs", async () => {
    const http = fakeHttp([robots(), fixture("matas-listing.html")], [matasVacancies()]);
    const jobs = await fetchVacancies(MATAS_URL, http, 0);
    expect(jobs).toHaveLength(21);
    expect(http.text.mock.calls.map(([url]) => url)).toEqual(["https://matas.career.emply.com/robots.txt", MATAS_URL]);
    expect(http.json).toHaveBeenCalledTimes(1);
    expect(http.json.mock.calls[0]?.[0]).toBe(pageEndpoint("https://matas.career.emply.com"));
    expect(http.json.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: { offset: 0 } });
  });

  it("builds each job link from the page's link path", async () => {
    const http = fakeHttp([robots(), fixture("matas-listing.html")], [matasVacancies()]);
    const [first] = await fetchVacancies(MATAS_URL, http, 0);
    expect(first?.url).toBe(
      "https://matas.career.emply.com/ad/faglaert-materialist-sales-assistant-til-30-timer-ugen-i-matas-odder/uj2j8e",
    );
  });

  it("uses the external ad link when the job is hosted elsewhere", async () => {
    const [vacancy] = matasVacancies().vacancies;
    const external = { ...vacancy, externalCseAdLink: "https://www.jobindex.dk/jobannonce/123" };
    const http = fakeHttp([robots(), fixture("matas-listing.html")], [page([external], 1)]);
    const [job] = await fetchVacancies(MATAS_URL, http, 0);
    expect(job?.url).toBe("https://www.jobindex.dk/jobannonce/123");
  });

  it("skips talent-pool entries, which are open applications rather than jobs", async () => {
    const [a, b] = matasVacancies().vacancies;
    const http = fakeHttp([robots(), fixture("matas-listing.html")], [page([a, { ...b, talentPool: true }], 2)]);
    const jobs = await fetchVacancies(MATAS_URL, http, 0);
    expect(jobs.map((j) => (j.vacancy as { id: string }).id)).toEqual([a?.id]);
  });

  it("follows the offset until it reaches the total count", async () => {
    const all = matasVacancies().vacancies;
    const http = fakeHttp([robots(), fixture("matas-listing.html")], [page(all.slice(0, 15), 21), page(all.slice(15), 21)]);
    const jobs = await fetchVacancies(MATAS_URL, http, 0);
    expect(jobs).toHaveLength(21);
    expect(http.json.mock.calls.map(([, request]) => (request as { body: { offset: number } }).body.offset)).toEqual([0, 15]);
  });

  it("returns no jobs for an empty job list", async () => {
    const http = fakeHttp([robots(), fixture("eg-listing.html")], [JSON.parse(fixture("empty.json"))]);
    await expect(fetchVacancies("https://eg.career.emply.com/da/ledige-stillinger", http, 0)).resolves.toEqual([]);
    expect(http.json).toHaveBeenCalledTimes(1);
  });

  it(`pauses ${PAUSE_MS} ms before each request for jobs`, async () => {
    vi.useFakeTimers();
    try {
      const http = fakeHttp([robots(), fixture("matas-listing.html")], [matasVacancies()]);
      const promise = fetchVacancies(MATAS_URL, http);
      await vi.advanceTimersByTimeAsync(0);
      expect(http.json).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(PAUSE_MS);
      await expect(promise).resolves.toHaveLength(21);
    } finally {
      vi.useRealTimers();
    }
  });

  it(`never asks for more than ${MAX_PAGES} pages`, async () => {
    const [vacancy] = matasVacancies().vacancies;
    const pages = Array.from({ length: MAX_PAGES + 3 }, (_, i) => page([{ ...vacancy, id: `job-${i}` }], 10_000));
    const http = fakeHttp([robots(), fixture("matas-listing.html")], pages);
    await fetchVacancies(MATAS_URL, http, 0);
    expect(http.json).toHaveBeenCalledTimes(MAX_PAGES);
  });

  it("stops before reading the page when robots.txt forbids it", async () => {
    const http = fakeHttp(["User-agent: *\nDisallow: /ledige-stillinger"], []);
    await expect(fetchVacancies(MATAS_URL, http, 0)).rejects.toThrow("robots-disallowed");
    expect(http.text).toHaveBeenCalledTimes(1);
  });

  it("fails clearly when the endpoint returns a different document", async () => {
    const http = fakeHttp([robots(), fixture("matas-listing.html")], [{ error: "nope" }]);
    await expect(fetchVacancies(MATAS_URL, http, 0)).rejects.toThrow("Emply response has no vacancies list");
  });
});

describe("emplyAdapter.normalize", () => {
  const jobs = async (): Promise<EmplyJob[]> =>
    fetchVacancies(MATAS_URL, fakeHttp([robots(), fixture("matas-listing.html")], [matasVacancies()]), 0);

  it("maps a real vacancy to a NormalizedJob", async () => {
    const job = emplyAdapter.normalize((await jobs())[0], matas);
    expect(job).toMatchObject({
      externalId: "9130d48b-5af7-4538-8a0e-56d0595629d6",
      title: "Faglært materialist/Sales Assistant til 30 timer/ugen i Matas Odder",
      company: "Matas",
      location: "Rosensgade 27, 8300, Odder, Denmark",
      remoteType: null,
      url: "https://matas.career.emply.com/ad/faglaert-materialist-sales-assistant-til-30-timer-ugen-i-matas-odder/uj2j8e",
      postedAt: new Date("2026-11-16T10:00:31.7050087Z"),
    });
    expect(job.description).toMatch(/^Drømmer du om et job indenfor salg/);
    expect(job.description).not.toMatch(/<[a-z]/i);
  });

  it("matches the snapshot for the first Matas job", async () => {
    expect(emplyAdapter.normalize((await jobs())[0], matas)).toMatchSnapshot();
  });

  it("normalizes every real vacancy with a unique id", async () => {
    const raw = await jobs();
    const { jobs: normalized, skipped } = normalizeJobs(emplyAdapter, raw, matas);
    expect(skipped).toBe(0);
    expect(new Set(normalized.map((j) => j.externalId)).size).toBe(raw.length);
  });

  it("falls back to the created date, and to null for an unreadable date", async () => {
    const [first] = await jobs();
    const vacancy = first!.vacancy as Record<string, unknown>;
    const created = emplyAdapter.normalize({ ...first, vacancy: { ...vacancy, published: null } }, matas);
    expect(created.postedAt).toEqual(new Date("2026-11-16T10:00:19.8526164Z"));
    const none = emplyAdapter.normalize({ ...first, vacancy: { ...vacancy, published: "soon", created: null } }, matas);
    expect(none.postedAt).toBeNull();
  });

  it("skips a broken vacancy and keeps the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [first, second] = await jobs();
    const { id: _id, ...broken } = second!.vacancy as Record<string, unknown>;
    const { jobs: normalized, skipped } = normalizeJobs(emplyAdapter, [first, { ...second, vacancy: broken }], matas);
    expect(skipped).toBe(1);
    expect(normalized).toHaveLength(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/normalize\.skipped .*"source":"EMPLY"/);
  });
});
