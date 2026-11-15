import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leverAdapter, parseLeverPostings, postingsUrl } from "../src/sources/lever";
import { normalizeJobs } from "../src/sources/normalize";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/lever", name), "utf8"));

const company = { slug: "veo", name: "Veo", sourceKey: "veo" };
const postings = (name = "veo.json") => parseLeverPostings(fixture(name));
const byTitle = (title: string) =>
  postings().find((raw) => (raw as { text: string }).text.trim() === title) as Record<string, unknown>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("postingsUrl", () => {
  it.each([
    ["veo", "https://api.lever.co/v0/postings/veo?mode=json"],
    [" veo ", "https://api.lever.co/v0/postings/veo?mode=json"],
    ["eu:example", "https://api.eu.lever.co/v0/postings/example?mode=json"],
  ])("%s → %s", (sourceKey, expected) => {
    expect(postingsUrl(sourceKey)).toBe(expected);
  });
});

describe("parseLeverPostings", () => {
  it.each([
    ["veo.json", 26],
    ["empty.json", 0],
  ])("finds every posting in %s (%i)", (name, count) => {
    expect(postings(name)).toHaveLength(count);
  });

  it.each([{ ok: false, error: "Document not found" }, "<html>", null])("throws on a response that is not a list: %j", (data) => {
    expect(() => parseLeverPostings(data)).toThrow("not a list of postings");
  });
});

describe("leverAdapter.fetchJobs", () => {
  it("calls the postings API once and returns the postings", async () => {
    const http = { text: vi.fn(), json: vi.fn().mockResolvedValue(fixture("veo.json")) };
    const raws = await leverAdapter.fetchJobs(company, http);
    expect(http.json).toHaveBeenCalledExactlyOnceWith("https://api.lever.co/v0/postings/veo?mode=json");
    expect(http.text).not.toHaveBeenCalled();
    expect(raws).toHaveLength(26);
  });
});

describe("leverAdapter.normalize", () => {
  it("maps a real posting to a NormalizedJob", () => {
    const job = leverAdapter.normalize(byTitle("Android Engineer"), company);
    expect(job).toMatchObject({
      externalId: "7ec8c80d-37f2-488c-a45a-c5460bad5645",
      title: "Android Engineer",
      company: "Veo",
      location: "Copenhagen Office, Denmark",
      remoteType: "onsite",
      url: "https://jobs.lever.co/veo/7ec8c80d-37f2-488c-a45a-c5460bad5645",
    });
    expect(job.postedAt).toBeInstanceOf(Date);
    expect({ ...job, description: job.description.slice(0, 200) }).toMatchSnapshot();
  });

  it("joins the intro, the list sections and the closing part into clean text", () => {
    const { description } = leverAdapter.normalize(byTitle("Android Engineer"), company);
    expect(description).toContain("What You Will Do\n- Write high-quality, maintainable Kotlin code");
    expect(description).not.toMatch(/<\/?[a-z][^>]*>|&nbsp;|&amp;/i);
  });

  it("adds the country name so the location filter can read it", () => {
    expect(leverAdapter.normalize(byTitle("US Partnership Manager – Basketball, Field Hockey & Baseball"), company).location)
      .toBe("Miami Office, United States");
  });

  it("does not repeat a country that is already in the place name", () => {
    const raw = { ...byTitle("Android Engineer"), categories: { allLocations: ["Copenhagen, Denmark"] } };
    expect(leverAdapter.normalize(raw, company).location).toBe("Copenhagen, Denmark");
  });

  it("lists every location of a multi-location posting", () => {
    const raw = { ...byTitle("Android Engineer"), country: null, categories: { allLocations: ["Copenhagen", "Remote"] } };
    expect(leverAdapter.normalize(raw, company).location).toBe("Copenhagen; Remote");
  });

  it.each([
    ["onsite", "onsite"],
    ["hybrid", "hybrid"],
    ["remote", "remote"],
    ["unspecified", null],
    [null, null],
  ])("maps workplaceType %s → %s", (workplaceType, expected) => {
    expect(leverAdapter.normalize({ ...byTitle("Android Engineer"), workplaceType }, company).remoteType).toBe(expected);
  });

  it("uses null when the creation time is missing", () => {
    expect(leverAdapter.normalize({ ...byTitle("Android Engineer"), createdAt: null }, company).postedAt).toBeNull();
  });

  it("normalizes every posting on the real board", () => {
    const { jobs, skipped } = normalizeJobs(leverAdapter, postings(), company);
    expect(skipped).toBe(0);
    expect(jobs).toHaveLength(26);
  });

  it("skips a broken posting and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { jobs, skipped } = normalizeJobs(leverAdapter, postings("one-broken-job.json"), company);
    expect(skipped).toBe(1);
    expect(jobs).toHaveLength(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/normalize\.skipped .*"source":"LEVER".*text/);
  });
});
