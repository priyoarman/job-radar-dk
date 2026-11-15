import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ashbyAdapter, boardUrl, parseAshbyBoard } from "../src/sources/ashby";
import { normalizeJobs } from "../src/sources/normalize";

const fixture = (name: string): { jobs: Record<string, unknown>[] } =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/ashby", name), "utf8"));

const company = { slug: "corti", name: "Corti", sourceKey: "corti" };
const jobs = (name: string) => parseAshbyBoard(fixture(name));
const byTitle = (name: string, title: string) =>
  jobs(name).find((raw) => (raw as { title: string }).title.trim() === title) as Record<string, unknown>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("boardUrl", () => {
  it("builds the public posting API URL", () => {
    expect(boardUrl("pleo")).toBe("https://api.ashbyhq.com/posting-api/job-board/pleo");
    expect(boardUrl(" toogoodtogo ")).toBe("https://api.ashbyhq.com/posting-api/job-board/toogoodtogo");
  });
});

describe("parseAshbyBoard", () => {
  it.each([
    ["pleo.json", 12],
    ["toogoodtogo.json", 12],
    ["corti.json", 3],
    ["empty.json", 0],
  ])("finds every listed job in %s (%i)", (name, count) => {
    expect(jobs(name)).toHaveLength(count);
  });

  it("leaves out jobs that are not listed", () => {
    const board = fixture("corti.json");
    board.jobs[0] = { ...board.jobs[0], isListed: false };
    expect(parseAshbyBoard(board)).toHaveLength(2);
  });

  it.each([{ error: "Not found" }, [], "<html>", null])("throws on a response that is not a job board: %j", (data) => {
    expect(() => parseAshbyBoard(data)).toThrow("no jobs list");
  });
});

describe("ashbyAdapter.fetchJobs", () => {
  it("calls the posting API once and returns the listed jobs", async () => {
    const http = { text: vi.fn(), json: vi.fn().mockResolvedValue(fixture("corti.json")) };
    const raws = await ashbyAdapter.fetchJobs(company, http);
    expect(http.json).toHaveBeenCalledExactlyOnceWith("https://api.ashbyhq.com/posting-api/job-board/corti");
    expect(http.text).not.toHaveBeenCalled();
    expect(raws).toHaveLength(3);
  });
});

describe("ashbyAdapter.normalize", () => {
  it("maps a real job to a NormalizedJob", () => {
    const job = ashbyAdapter.normalize(byTitle("corti.json", "GTM Engineer"), company);
    expect(job).toMatchObject({
      externalId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      title: "GTM Engineer",
      company: "Corti",
      location: "Copenhagen, Denmark",
      remoteType: null,
      url: expect.stringMatching(/^https:\/\/jobs\.ashbyhq\.com\/corti\//),
    });
    expect(job.postedAt).toBeInstanceOf(Date);
    expect(job.description).toContain("We’re looking for a GTM Engineer");
    expect({ ...job, description: job.description.slice(0, 200) }).toMatchSnapshot();
  });

  it("includes secondary locations, which can reveal Denmark", () => {
    expect(ashbyAdapter.normalize(byTitle("pleo.json", "Analytics Engineer"), company).location).toBe(
      "United Kingdom; Denmark; Portugal; Spain",
    );
  });

  it.each([
    ["corti.json", "GTM Engineer", "Copenhagen, Denmark"],
    ["toogoodtogo.json", "Head of Key Accounts", "London, UK"],
    ["toogoodtogo.json", "CRM Manager (Braze Preferred)", "New York, NY (US)"],
    ["pleo.json", "Account Manager UKI", "London"],
  ])("formats the location of %s / %s as %s", (file, title, expected) => {
    expect(ashbyAdapter.normalize(byTitle(file, title), company).location).toBe(expected);
  });

  it.each([
    ["OnSite", "onsite"],
    ["Hybrid", "hybrid"],
    ["Remote", "remote"],
    [null, null],
  ])("maps workplaceType %s → %s", (workplaceType, expected) => {
    expect(ashbyAdapter.normalize({ ...byTitle("corti.json", "GTM Engineer"), workplaceType }, company).remoteType).toBe(expected);
  });

  it("turns the HTML description into clean text", () => {
    for (const name of ["pleo.json", "toogoodtogo.json", "corti.json"]) {
      for (const raw of jobs(name)) {
        expect(ashbyAdapter.normalize(raw, company).description).not.toMatch(/<\/?[a-z][^>]*>|&nbsp;|&amp;/i);
      }
    }
  });

  it("uses null for a missing publish date", () => {
    expect(ashbyAdapter.normalize({ ...byTitle("corti.json", "GTM Engineer"), publishedAt: null }, company).postedAt).toBeNull();
  });

  it("normalizes every job in the real boards", () => {
    for (const name of ["pleo.json", "toogoodtogo.json", "corti.json"]) {
      const raws = jobs(name);
      const { jobs: normalized, skipped } = normalizeJobs(ashbyAdapter, raws, company);
      expect(skipped).toBe(0);
      expect(normalized).toHaveLength(raws.length);
    }
  });

  it("skips a broken job and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { jobs: normalized, skipped } = normalizeJobs(ashbyAdapter, jobs("one-broken-job.json"), company);
    expect(skipped).toBe(1);
    expect(normalized).toHaveLength(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/normalize\.skipped .*"source":"ASHBY".*title/);
  });
});
