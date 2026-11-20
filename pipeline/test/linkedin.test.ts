import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LINKEDIN_ACTOR, linkedinAdapter, searchInput } from "../src/sources/linkedin";
import { normalizeJobs } from "../src/sources/normalize";

const raws = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "fixtures/linkedin/react-typescript-dk.json"), "utf8"),
) as Record<string, unknown>[];

const SEARCH_URL =
  "https://www.linkedin.com/jobs/search?keywords=React%20Typescript&location=Denmark&geoId=104514075&f_TPR=r86400";
const company = { slug: "linkedin-react-typescript", name: "LinkedIn", sourceKey: SEARCH_URL };
const http = { text: vi.fn(), json: vi.fn() };

describe("searchInput", () => {
  it("turns the LinkedIn search link into the Apify actor's input", () => {
    expect(searchInput(SEARCH_URL)).toEqual({
      keywords: "React Typescript",
      location: "Denmark",
      datePosted: "r86400",
      limit: 100,
    });
  });

  it("leaves out a time filter the actor does not know", () => {
    expect(searchInput("https://www.linkedin.com/jobs/search?keywords=React&f_TPR=r3600")).toEqual({
      keywords: "React",
      limit: 100,
    });
  });

  it("refuses a link without keywords", () => {
    expect(() => searchInput("https://www.linkedin.com/jobs/search?location=Denmark")).toThrow("no keywords");
  });
});

describe("linkedinAdapter.fetchJobs", () => {
  it("runs the LinkedIn actor once with the search from the link", async () => {
    const runActor = vi.fn().mockResolvedValue(raws);
    const result = await linkedinAdapter.fetchJobs(company, http, { runActor });
    expect(runActor).toHaveBeenCalledExactlyOnceWith(LINKEDIN_ACTOR, searchInput(SEARCH_URL));
    expect(result).toHaveLength(raws.length);
    expect(http.json).not.toHaveBeenCalled();
  });

  it("fails clearly when no Apify token is configured", async () => {
    await expect(linkedinAdapter.fetchJobs(company, http, { runActor: null })).rejects.toThrow("APIFY_TOKEN is not set");
  });
});

describe("linkedinAdapter.normalize", () => {
  it("keeps the real employer and links to the LinkedIn job page", () => {
    expect(linkedinAdapter.normalize(raws[1], company)).toEqual({
      externalId: "4492935922",
      title: "Fullstack Engineer - CPH",
      company: "Lunar",
      location: "Copenhagen, Capital Region of Denmark, Denmark",
      remoteType: null,
      description: "Lunar is looking for a Fullstack Engineer in Copenhagen.",
      url: "https://www.linkedin.com/jobs/view/4492935922",
      postedAt: new Date("2026-11-20T00:00:00.000Z"),
    });
  });

  it("falls back to the source name when the employer is missing", () => {
    expect(linkedinAdapter.normalize({ ...raws[0], companyName: "" }, company).company).toBe("LinkedIn");
  });

  it("normalizes every job in the real search result", () => {
    const { jobs, skipped } = normalizeJobs(linkedinAdapter, raws, company);
    expect(skipped).toBe(0);
    expect(jobs).toHaveLength(raws.length);
  });
});
