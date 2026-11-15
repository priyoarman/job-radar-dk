import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTeamtailorFeed } from "../src/sources/teamtailor";

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
