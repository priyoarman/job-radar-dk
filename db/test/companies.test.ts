import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { boardChanged, parseCompanies } from "../src/companies";

const valid = {
  slug: "example-co",
  name: "Example Co",
  source: "TEAMTAILOR",
  sourceKey: "https://example.teamtailor.com",
};

describe("parseCompanies", () => {
  it("accepts the real config/companies.json", () => {
    const file = resolve(import.meta.dirname, "../../config/companies.json");
    const companies = parseCompanies(JSON.parse(readFileSync(file, "utf8")));
    expect(companies.length).toBeGreaterThan(0);
  });

  it("fills in defaults for tags and active", () => {
    const [company] = parseCompanies([valid]);
    expect(company).toMatchObject({ tags: [], active: true });
  });

  it.each([
    ["a typo in source", { ...valid, source: "TEAMTAILR" }, "source"],
    ["a new source type without an adapter", { ...valid, source: "TALENTECH" }, 'no adapter for source "TALENTECH"'],
    ["a source type that does not exist", { ...valid, source: "LINKEDIN" }, "source"],
    ["an invalid slug", { ...valid, slug: "Example Co" }, "lowercase"],
    ["a missing name", { ...valid, name: undefined }, "name"],
    ["an unknown field", { ...valid, sorce: "x" }, "sorce"],
    ["a bad careersUrl", { ...valid, careersUrl: "not a url" }, "careersUrl"],
  ])("rejects %s", (_label, company, expected) => {
    expect(() => parseCompanies([company])).toThrow(expected);
  });

  it("rejects duplicate slugs", () => {
    const other = { ...valid, sourceKey: "https://other.teamtailor.com" };
    expect(() => parseCompanies([valid, other])).toThrow('duplicate slug "example-co"');
  });

  it("rejects two companies with the same feed", () => {
    expect(() => parseCompanies([valid, { ...valid, slug: "copy" }])).toThrow(
      "duplicate source + sourceKey",
    );
  });

  it("rejects a file that is not a list", () => {
    expect(() => parseCompanies({ companies: [] })).toThrow("Invalid companies file");
  });
});

describe("boardChanged", () => {
  const board = { source: "TEAMTAILOR" as const, sourceKey: "https://example.teamtailor.com" };

  it.each([
    ["a new company", undefined, board, false],
    ["the same board", board, { ...board }, false],
    ["a new sourceKey", board, { ...board, sourceKey: "https://careers.example.com" }, true],
    ["a new source", board, { source: "GREENHOUSE" as const, sourceKey: board.sourceKey }, true],
  ])("%s → %s", (_label, existing, seed, expected) => {
    expect(boardChanged(existing, seed)).toBe(expected);
  });
});
