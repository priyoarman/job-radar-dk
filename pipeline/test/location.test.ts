import { describe, expect, it } from "vitest";
import { classifyPlace, isAbroadOnly } from "../src/steps/location";

describe("classifyPlace", () => {
  it.each([
    ["København, Denmark", "denmark"],
    ["Copenhagen", "denmark"],
    ["Herlev, Denmark", "denmark"],
    ["Kgs. Lyngby", "denmark"],
    ["Aarhus C", "denmark"],
    ["Remote - Denmark", "denmark"],
    ["Hybrid in CPH", "denmark"],
    ["Berlin, Germany", "abroad"],
    ["Sultanbeyli, Turkiye", "abroad"],
    ["Immingham, United Kingdom", "abroad"],
    ["London", "abroad"],
    ["Remote (US)", "abroad"],
    ["Remote, Sweden", "abroad"],
    ["Remote", "region"],
    ["Europe", "region"],
    ["EMEA", "region"],
    ["Nordics", "region"],
    ["Somewhere Nice", "unknown"],
    ["Us and them", "unknown"],
  ])("%s → %s", (place, expected) => {
    expect(classifyPlace(place)).toBe(expected);
  });
});

describe("isAbroadOnly", () => {
  it.each<[string | null, boolean]>([
    ["København, Denmark", false],
    ["København, Denmark; Aarhus, Denmark; Stockholm, Sweden", false],
    ["Berlin, Germany; Eindhoven, Netherlands", true],
    ["Larkhall, United Kingdom", true],
    ["London / Copenhagen", false],
    ["Amsterdam; Remote", false],
    ["Oslo, Norway; Somewhere Nice", false],
    [null, false],
    ["", false],
  ])("%s → %s", (location, expected) => {
    expect(isAbroadOnly(location)).toBe(expected);
  });
});

describe("classifyPlace on global job boards", () => {
  it.each([
    "Mountain View, California",
    "Remote - California",
    "Remote - Washington D.C.",
    "Washington, D.C.",
    "Bellevue, Washington",
    "New Jersey",
    "Chicago, Illinois",
    "Mountain View, CA",
    "New York, NY (US)",
    "USCA",
    "US-NY",
    "Seoul, South Korea",
    "Costa Rica",
    "Auckland, New Zealand",
    "Toronto, Ontario",
    "Myanmar",
    "Türkiye",
    "Greenland",
    "Melbourne",
    "Sydney",
    "Chicago",
    "Montreal",
    "APAC",
    "NAMER",
    "North America",
    "Latin America",
    "South America",
  ])("%s → abroad", (place) => {
    expect(classifyPlace(place)).toBe("abroad");
  });

  it.each(["Remote", "Remote - Europe", "European Union", "EMEA", "Nordics"])("%s stays a region", (place) => {
    expect(classifyPlace(place)).toBe("region");
  });

  it.each(["Aarhus, Denmark", "Remote IN Denmark", "Copenhagen, Capital Region", "Herlev"])("%s stays in Denmark", (place) => {
    expect(classifyPlace(place)).toBe("denmark");
  });

  it("only reads US state codes after a comma", () => {
    expect(classifyPlace("IN office")).toBe("unknown");
    expect(classifyPlace("Indianapolis, IN")).toBe("abroad");
  });

  it("drops the US-only jobs that leaked through on Databricks' real board", () => {
    expect(isAbroadOnly("Mountain View, California")).toBe(true);
    expect(isAbroadOnly("Remote - Ohio")).toBe(true);
    expect(isAbroadOnly("Aarhus, Denmark")).toBe(false);
    expect(isAbroadOnly("Mountain View, California; Aarhus, Denmark")).toBe(false);
  });

  it("drops the other leaks found on Sitecore's and Valtech's real boards", () => {
    expect(isAbroadOnly("Singapore; Melbourne; Sydney")).toBe(true);
    expect(isAbroadOnly("Latin America; North America")).toBe(true);
    expect(isAbroadOnly("Chicago")).toBe(true);
  });

  it("keeps jobs open to Europe-wide regions, which can include Denmark", () => {
    expect(isAbroadOnly("NAMER, United States; India; European Union; EMEA")).toBe(false);
    expect(isAbroadOnly("Remote")).toBe(false);
  });
});
