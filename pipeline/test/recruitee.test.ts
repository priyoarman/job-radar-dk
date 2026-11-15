import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeJobs } from "../src/sources/normalize";
import { offersUrl, parseRecruiteeOffers, recruiteeAdapter } from "../src/sources/recruitee";

const fixture = (name: string): { offers: Record<string, unknown>[] } =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/recruitee", name), "utf8"));

const company = { slug: "signifly", name: "Signifly", sourceKey: "signifly" };
const offers = (name = "signifly.json") => parseRecruiteeOffers(fixture(name));
const byTitle = (title: string) =>
  offers().find((raw) => (raw as { title: string }).title.trim() === title) as Record<string, unknown>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("offersUrl", () => {
  it("builds the public offers API URL on the company's subdomain", () => {
    expect(offersUrl("signifly")).toBe("https://signifly.recruitee.com/api/offers/");
    expect(offersUrl(" signifly ")).toBe("https://signifly.recruitee.com/api/offers/");
  });
});

describe("parseRecruiteeOffers", () => {
  it.each([
    ["signifly.json", 9],
    ["empty.json", 0],
  ])("finds every published offer in %s (%i)", (name, count) => {
    expect(offers(name)).toHaveLength(count);
  });

  it("leaves out offers that are not published", () => {
    const data = fixture("signifly.json");
    data.offers[0] = { ...data.offers[0], status: "closed" };
    data.offers[1] = { ...data.offers[1], status: "draft" };
    expect(parseRecruiteeOffers(data)).toHaveLength(7);
  });

  it.each([{ error: "Not found" }, [], "<html>", null])("throws on a response that is not an offers list: %j", (data) => {
    expect(() => parseRecruiteeOffers(data)).toThrow("no offers list");
  });
});

describe("recruiteeAdapter.fetchJobs", () => {
  it("calls the offers API once and returns the published offers", async () => {
    const http = { text: vi.fn(), json: vi.fn().mockResolvedValue(fixture("signifly.json")) };
    const raws = await recruiteeAdapter.fetchJobs(company, http);
    expect(http.json).toHaveBeenCalledExactlyOnceWith("https://signifly.recruitee.com/api/offers/");
    expect(http.text).not.toHaveBeenCalled();
    expect(raws).toHaveLength(9);
  });
});

describe("recruiteeAdapter.normalize", () => {
  it("maps a real offer to a NormalizedJob", () => {
    const job = recruiteeAdapter.normalize(byTitle("Creative Developer"), company);
    expect(job).toMatchObject({
      externalId: "2783683",
      title: "Creative Developer",
      company: "Signifly",
      location: "Copenhagen V, Denmark",
      remoteType: "onsite",
      url: "https://jobs.signifly.com/o/creative-developer",
      postedAt: new Date("2026-10-14T13:00:15Z"),
    });
    expect({ ...job, description: job.description.slice(0, 200) }).toMatchSnapshot();
  });

  it("joins the description and the requirements, and drops embedded images", () => {
    const { description } = recruiteeAdapter.normalize(byTitle("Creative Developer"), company);
    expect(description).toContain("TypeScript, Next.js, and React");
    expect(description).not.toMatch(/data:image|base64|<\/?[a-z][^>]*>|&nbsp;/i);
  });

  it("reads the country from the locations list", () => {
    expect(recruiteeAdapter.normalize(byTitle("Senior Strategist"), company).location).toBe("Monteal, Canada");
  });

  it("falls back to the location text when there is no locations list", () => {
    const raw = { ...byTitle("Creative Developer"), locations: [] };
    expect(recruiteeAdapter.normalize(raw, company).location).toBe("Copenhagen V, Hovedstaden, Denmark");
  });

  it.each([
    [{ remote: true, hybrid: true, on_site: true }, "remote"],
    [{ remote: false, hybrid: true, on_site: true }, "hybrid"],
    [{ remote: false, hybrid: false, on_site: true }, "onsite"],
    [{ remote: false, hybrid: false, on_site: false }, null],
  ])("maps the work-mode flags %j → %s", (flags, expected) => {
    expect(recruiteeAdapter.normalize({ ...byTitle("Creative Developer"), ...flags }, company).remoteType).toBe(expected);
  });

  it.each([
    ["2026-10-14 13:00:15 UTC", "2026-10-14T13:00:15.000Z"],
    ["2026-10-14T13:00:15Z", "2026-10-14T13:00:15.000Z"],
  ])("reads the publish date %s", (published_at, expected) => {
    expect(recruiteeAdapter.normalize({ ...byTitle("Creative Developer"), published_at }, company).postedAt?.toISOString()).toBe(expected);
  });

  it("uses null for a missing or unreadable publish date", () => {
    expect(recruiteeAdapter.normalize({ ...byTitle("Creative Developer"), published_at: null }, company).postedAt).toBeNull();
    expect(recruiteeAdapter.normalize({ ...byTitle("Creative Developer"), published_at: "soon" }, company).postedAt).toBeNull();
  });

  it("normalizes every offer on the real board", () => {
    const { jobs, skipped } = normalizeJobs(recruiteeAdapter, offers(), company);
    expect(skipped).toBe(0);
    expect(jobs).toHaveLength(9);
  });

  it("skips a broken offer and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { jobs, skipped } = normalizeJobs(recruiteeAdapter, offers("one-broken-job.json"), company);
    expect(skipped).toBe(1);
    expect(jobs).toHaveLength(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/normalize\.skipped .*"source":"RECRUITEE".*title/);
  });
});
