import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeJobs } from "../src/sources/normalize";
import { type TeamtailorRawItem, parseTeamtailorFeed, teamtailorAdapter } from "../src/sources/teamtailor";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, "fixtures/teamtailor", name), "utf8");

describe("parseTeamtailorFeed", () => {
  it.each([
    ["lunar.rss", 19],
    ["formalize.rss", 11],
    ["templafy.rss", 4],
    ["single-item.rss", 1],
    ["vivino-empty.rss", 0],
  ])("parses %s into %i items", (name, count) => {
    const items = parseTeamtailorFeed(fixture(name));
    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(count);
  });

  it("keeps a single item and its locations as arrays", () => {
    const [item] = parseTeamtailorFeed(fixture("single-item.rss"));
    expect(item).toMatchObject({
      title: "Senior Regulatory Data Engineer",
      remoteStatus: expect.any(String),
      guid: expect.stringMatching(/^[0-9a-f-]{36}$/),
      link: "https://jobs.lunar.app/jobs/8671990-senior-regulatory-data-engineer",
    });
    const locations = item?.locations === "" ? [] : item?.locations?.location;
    expect(locations?.map((l) => l.city)).toEqual(["København", "Aarhus", "Stockholm"]);
  });

  it("keeps a job with one location as an array of one", () => {
    const [first] = parseTeamtailorFeed(fixture("lunar.rss"));
    const locations = first?.locations === "" ? [] : first?.locations?.location;
    expect(locations).toHaveLength(1);
  });

  it("keeps every value as a string, even ones that look like numbers", () => {
    const items = parseTeamtailorFeed(fixture("templafy.rss"));
    const zips = items.flatMap((i) => (i.locations === "" ? [] : (i.locations?.location ?? [])).map((l) => l.zip));
    expect(zips).toContain("10007");
    for (const zip of zips) expect(typeof zip === "string" || zip === undefined).toBe(true);
  });

  it("turns the escaped description into HTML", () => {
    const [item] = parseTeamtailorFeed(fixture("templafy.rss"));
    expect(item?.description).toMatch(/^<p>/);
    expect(item?.description).not.toContain("&lt;");
  });

  it("gives every item a unique guid", () => {
    const items = parseTeamtailorFeed(fixture("lunar.rss"));
    const guids = items.map((i) => i.guid);
    expect(new Set(guids).size).toBe(items.length);
    expect(guids.every(Boolean)).toBe(true);
  });

  it("throws on XML that is cut off", () => {
    const xml = fixture("lunar.rss");
    expect(() => parseTeamtailorFeed(xml.slice(0, xml.length / 2))).toThrow(/not valid XML/);
  });

  it("throws on a valid document that is not an RSS feed", () => {
    expect(() => parseTeamtailorFeed("<html><body>Maintenance</body></html>")).toThrow(/no <rss><channel>/);
  });

  it("throws on an empty response", () => {
    expect(() => parseTeamtailorFeed("")).toThrow();
  });
});

const company = { slug: "lunar", name: "Lunar", sourceKey: "https://lunar.teamtailor.com" };
const singleItem = () => parseTeamtailorFeed(fixture("single-item.rss"))[0] as TeamtailorRawItem;

describe("teamtailorAdapter.fetchJobs", () => {
  it.each(["https://lunar.teamtailor.com", "https://lunar.teamtailor.com/"])(
    "fetches <sourceKey>/jobs.rss for %s",
    async (sourceKey) => {
      const http = { text: vi.fn().mockResolvedValue(fixture("lunar.rss")), json: vi.fn() };
      const items = await teamtailorAdapter.fetchJobs({ ...company, sourceKey }, http);
      expect(http.text).toHaveBeenCalledExactlyOnceWith("https://lunar.teamtailor.com/jobs.rss");
      expect(http.json).not.toHaveBeenCalled();
      expect(items).toHaveLength(19);
    },
  );

  it("passes fetch errors through", async () => {
    const http = { text: vi.fn().mockRejectedValue(new Error("HTTP 503")), json: vi.fn() };
    await expect(teamtailorAdapter.fetchJobs(company, http)).rejects.toThrow("HTTP 503");
  });
});

describe("teamtailorAdapter.normalize", () => {
  it("maps a real item to a NormalizedJob", () => {
    const job = teamtailorAdapter.normalize(singleItem(), company);
    expect(job).toMatchObject({
      externalId: "b1df10ef-b0dd-45e6-99b6-6b07da9fd819",
      title: "Senior Regulatory Data Engineer",
      company: "Lunar",
      location: "København, Denmark; Aarhus, Denmark; Stockholm, Sweden",
      remoteType: null,
      url: "https://jobs.lunar.app/jobs/8671990-senior-regulatory-data-engineer",
    });
    expect(job.postedAt).toBeInstanceOf(Date);
    expect(job.description).not.toMatch(/<[a-z]/i);
    expect({ ...job, description: job.description.slice(0, 300) }).toMatchSnapshot();
  });

  it("normalizes every job in every fixture", () => {
    for (const name of ["lunar.rss", "formalize.rss", "templafy.rss"]) {
      const raws = parseTeamtailorFeed(fixture(name));
      const { jobs, skipped } = normalizeJobs(teamtailorAdapter, raws, company);
      expect(skipped).toBe(0);
      expect(jobs).toHaveLength(raws.length);
    }
  });

  it.each([
    ["fully", "remote"],
    ["hybrid", "hybrid"],
    ["onsite", "onsite"],
    ["none", null],
    ["temporary", null],
    [undefined, null],
  ])("maps remoteStatus %s to %s", (remoteStatus, expected) => {
    const job = teamtailorAdapter.normalize({ ...singleItem(), remoteStatus }, company);
    expect(job.remoteType).toBe(expected);
  });

  it("uses the link as externalId when there is no guid", () => {
    const raw = { ...singleItem(), guid: undefined };
    expect(teamtailorAdapter.normalize(raw, company).externalId).toBe(raw.link);
  });

  it("uses null for a date it cannot read", () => {
    expect(teamtailorAdapter.normalize({ ...singleItem(), pubDate: "soon" }, company).postedAt).toBeNull();
    expect(teamtailorAdapter.normalize({ ...singleItem(), pubDate: undefined }, company).postedAt).toBeNull();
  });

  it("uses null when there are no locations and removes duplicates", () => {
    expect(teamtailorAdapter.normalize({ ...singleItem(), locations: "" }, company).location).toBeNull();
    const cph = { city: "København", country: "Denmark" };
    const raw = { ...singleItem(), locations: { location: [cph, cph, { name: "Remote" }] } };
    expect(teamtailorAdapter.normalize(raw, company).location).toBe("København, Denmark; Remote");
  });

  it("takes the company name from our database, not the feed", () => {
    const raw = { ...singleItem(), company_name: "Something Else" };
    expect(teamtailorAdapter.normalize(raw, company).company).toBe("Lunar");
  });
});

describe("normalizeJobs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips and logs a job with no title, and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raws = parseTeamtailorFeed(fixture("templafy.rss"));
    const broken = { ...raws[1], title: undefined };
    const { jobs, skipped } = normalizeJobs(teamtailorAdapter, [raws[0]!, broken, raws[2]!], company);

    expect(skipped).toBe(1);
    expect(jobs.map((j) => j.title)).toEqual([raws[0]?.title, raws[2]?.title]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/^WARN normalize\.skipped .*"company":"lunar".*"index":1.*title/);
  });

  it("also survives an adapter that throws a plain Error", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = {
      ...teamtailorAdapter,
      normalize: () => {
        throw new Error("boom");
      },
    };
    expect(normalizeJobs(adapter, [singleItem()], company)).toEqual({ jobs: [], skipped: 1 });
  });
});
