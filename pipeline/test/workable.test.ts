import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeJobs } from "../src/sources/normalize";
import { accountUrl, parseWorkableAccount, workableAdapter } from "../src/sources/workable";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/workable", name), "utf8"));

const company = { slug: "dreamdata", name: "Dreamdata", sourceKey: "dreamdata" };
const jobs = (name = "dreamdata.json") => parseWorkableAccount(fixture(name));
const byCode = (shortcode: string) =>
  jobs().find((raw) => (raw as { shortcode: string }).shortcode === shortcode) as Record<string, unknown>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("accountUrl", () => {
  it("builds the public widget API URL with job details", () => {
    expect(accountUrl("dreamdata")).toBe("https://apply.workable.com/api/v1/widget/accounts/dreamdata?details=true");
    expect(accountUrl(" dreamdata ")).toBe("https://apply.workable.com/api/v1/widget/accounts/dreamdata?details=true");
  });
});

describe("parseWorkableAccount", () => {
  it.each([
    ["dreamdata.json", 4],
    ["empty.json", 0],
  ])("finds every job in %s (%i)", (name, count) => {
    expect(jobs(name)).toHaveLength(count);
  });

  it.each([{ error: "Not found" }, [], "<html>", null])("throws on a response that is not an account: %j", (data) => {
    expect(() => parseWorkableAccount(data)).toThrow("no jobs list");
  });
});

describe("workableAdapter.fetchJobs", () => {
  it("calls the widget API once and returns the jobs", async () => {
    const http = { text: vi.fn(), json: vi.fn().mockResolvedValue(fixture("dreamdata.json")) };
    const raws = await workableAdapter.fetchJobs(company, http);
    expect(http.json).toHaveBeenCalledExactlyOnceWith(accountUrl("dreamdata"));
    expect(http.text).not.toHaveBeenCalled();
    expect(raws).toHaveLength(4);
  });
});

describe("workableAdapter.normalize", () => {
  it("maps a real job to a NormalizedJob", () => {
    const job = workableAdapter.normalize(byCode("F6E15A2C50"), company);
    expect(job).toMatchObject({
      externalId: "F6E15A2C50",
      title: expect.stringMatching(/^Deployment Strategist/),
      company: "Dreamdata",
      location: "Copenhagen, Denmark",
      remoteType: null,
      url: "https://apply.workable.com/j/F6E15A2C50",
      postedAt: new Date("2026-11-09"),
    });
    expect(job.description.startsWith("About Dreamdata")).toBe(true);
    expect({ ...job, description: job.description.slice(0, 200) }).toMatchSnapshot();
  });

  it("keeps the same role in two countries as two separate jobs", () => {
    const [dk, us] = [byCode("F6E15A2C50"), byCode("CA669E5CE4")].map((raw) => workableAdapter.normalize(raw, company));
    expect(dk?.title).toBe(us?.title);
    expect([dk?.externalId, dk?.location]).toEqual(["F6E15A2C50", "Copenhagen, Denmark"]);
    expect([us?.externalId, us?.location]).toEqual(["CA669E5CE4", "New York, United States"]);
  });

  it("skips hidden locations and falls back to city and country", () => {
    const hidden = { ...byCode("F6E15A2C50"), locations: [{ city: "Secret", country: "Nowhere", hidden: true }] };
    expect(workableAdapter.normalize(hidden, company).location).toBe("Copenhagen, Denmark");
  });

  it("uses null when no location is given at all", () => {
    const raw = { ...byCode("F6E15A2C50"), locations: [], city: null, country: null };
    expect(workableAdapter.normalize(raw, company).location).toBeNull();
  });

  it.each([
    [true, "remote"],
    [false, null],
    [null, null],
  ])("maps telecommuting %s → %s", (telecommuting, expected) => {
    expect(workableAdapter.normalize({ ...byCode("F6E15A2C50"), telecommuting }, company).remoteType).toBe(expected);
  });

  it("turns the HTML description into clean text", () => {
    for (const raw of jobs()) {
      expect(workableAdapter.normalize(raw, company).description).not.toMatch(/<\/?[a-z][^>]*>|&nbsp;|&amp;/i);
    }
  });

  it("uses null for a missing or unreadable publish date", () => {
    expect(workableAdapter.normalize({ ...byCode("F6E15A2C50"), published_on: null }, company).postedAt).toBeNull();
    expect(workableAdapter.normalize({ ...byCode("F6E15A2C50"), published_on: "soon" }, company).postedAt).toBeNull();
  });

  it("normalizes every job on the real board", () => {
    const { jobs: normalized, skipped } = normalizeJobs(workableAdapter, jobs(), company);
    expect(skipped).toBe(0);
    expect(normalized).toHaveLength(4);
  });

  it("skips a broken job and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { jobs: normalized, skipped } = normalizeJobs(workableAdapter, jobs("one-broken-job.json"), company);
    expect(skipped).toBe(1);
    expect(normalized).toHaveLength(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/normalize\.skipped .*"source":"WORKABLE".*title/);
  });
});
