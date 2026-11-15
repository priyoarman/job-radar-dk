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
