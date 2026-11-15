import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardUrl, greenhouseAdapter, parseGreenhouseBoard } from "../src/sources/greenhouse";
import { normalizeJobs } from "../src/sources/normalize";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/greenhouse", name), "utf8"));

const company = { slug: "trustpilot", name: "Trustpilot", sourceKey: "trustpilot" };
const jobs = (name: string) => parseGreenhouseBoard(fixture(name));
const byTitle = (title: string) =>
  jobs("trustpilot.json").find((raw) => (raw as { title: string }).title.trim() === title) as Record<string, unknown>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("boardUrl", () => {
  it("builds the public job board API URL with the job descriptions", () => {
    expect(boardUrl("trustpilot")).toBe("https://boards-api.greenhouse.io/v1/boards/trustpilot/jobs?content=true");
    expect(boardUrl(" brandwatch ")).toBe("https://boards-api.greenhouse.io/v1/boards/brandwatch/jobs?content=true");
  });
});

describe("parseGreenhouseBoard", () => {
  it.each([
    ["trustpilot.json", 29],
    ["brandwatch.json", 6],
    ["empty.json", 0],
  ])("finds every job in %s (%i)", (name, count) => {
    expect(jobs(name)).toHaveLength(count);
  });

  it.each([{ error: "Not found" }, [], "<html>", null])("throws on a response that is not a job board: %j", (data) => {
    expect(() => parseGreenhouseBoard(data)).toThrow("no jobs list");
  });
});

describe("greenhouseAdapter.fetchJobs", () => {
  it("calls the board API once and returns its jobs", async () => {
    const http = { text: vi.fn(), json: vi.fn().mockResolvedValue(fixture("brandwatch.json")) };
    const raws = await greenhouseAdapter.fetchJobs({ ...company, sourceKey: "brandwatch" }, http);
    expect(http.json).toHaveBeenCalledExactlyOnceWith(boardUrl("brandwatch"));
    expect(http.text).not.toHaveBeenCalled();
    expect(raws).toHaveLength(6);
  });
});

describe("greenhouseAdapter.normalize", () => {
  it("maps a real job to a NormalizedJob", () => {
    const job = greenhouseAdapter.normalize(byTitle("Account Executive - French Mid-Market (French Speaking)"), company);
    expect(job).toMatchObject({
      externalId: expect.stringMatching(/^\d+$/),
      title: "Account Executive - French Mid-Market (French Speaking)",
      company: "Trustpilot",
      location: "Copenhagen, Denmark",
      remoteType: null,
      url: expect.stringMatching(/^https:\/\/corporate\.trustpilot\.com\/careers\/job\/\d+/),
    });
    expect(job.postedAt).toBeInstanceOf(Date);
    expect(job.description.startsWith("At Trustpilot, we're on an incredible journey.")).toBe(true);
    expect({ ...job, description: job.description.slice(0, 200) }).toMatchSnapshot();
  });

  it("decodes the escaped HTML in the description into plain text", () => {
    for (const raw of jobs("trustpilot.json")) {
      const { description } = greenhouseAdapter.normalize(raw, company);
      expect(description).not.toMatch(/<\/?[a-z][^>]*>|&lt;|&amp;|&nbsp;/i);
      expect(description.length).toBeGreaterThan(200);
    }
  });

  it("uses the full office locations, which can reveal a Danish office", () => {
    const raw = jobs("trustpilot.json").find(
      (r) => (r as { location: { name: string } }).location.name === "London" &&
        (r as { offices: { location: string }[] }).offices.some((o) => o.location.includes("Denmark")),
    );
    expect(greenhouseAdapter.normalize(raw, company).location).toBe("Copenhagen, Denmark; London, United Kingdom");
  });

  it("trims stray spaces in titles", () => {
    expect(greenhouseAdapter.normalize(byTitle("Legal Counsel - Disputes"), company).title).toBe("Legal Counsel - Disputes");
  });

  it("falls back to the location name when there are no offices", () => {
    const raw = { ...byTitle("Legal Counsel - Disputes"), offices: [] };
    expect(greenhouseAdapter.normalize(raw, company).location).toBe("London");
  });

  it.each([
    ["Remote - Denmark", "remote"],
    ["Hybrid (Copenhagen)", "hybrid"],
    ["Copenhagen", null],
  ])("reads remote type from the location %s → %s", (name, expected) => {
    const raw = { ...byTitle("Legal Counsel - Disputes"), location: { name } };
    expect(greenhouseAdapter.normalize(raw, company).remoteType).toBe(expected);
  });

  it("uses null for a missing or unreadable publish date", () => {
    expect(greenhouseAdapter.normalize({ ...byTitle("Legal Counsel - Disputes"), first_published: null }, company).postedAt).toBeNull();
    expect(greenhouseAdapter.normalize({ ...byTitle("Legal Counsel - Disputes"), first_published: "soon" }, company).postedAt).toBeNull();
  });

  it("normalizes every job in both real boards", () => {
    for (const name of ["trustpilot.json", "brandwatch.json"]) {
      const raws = jobs(name);
      const { jobs: normalized, skipped } = normalizeJobs(greenhouseAdapter, raws, company);
      expect(skipped).toBe(0);
      expect(normalized).toHaveLength(raws.length);
    }
  });

  it("skips a broken job and keeps the rest of the board", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { jobs: normalized, skipped } = normalizeJobs(greenhouseAdapter, jobs("one-broken-job.json"), company);
    expect(skipped).toBe(1);
    expect(normalized).toHaveLength(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/normalize\.skipped .*"source":"GREENHOUSE".*title/);
  });
});
