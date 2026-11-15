import { SUPPORTED_SOURCES, SourceType } from "@jobradar/db";
import { describe, expect, it } from "vitest";
import { adapters, getAdapter } from "../src/sources/registry";
import { teamtailorAdapter } from "../src/sources/teamtailor";

describe("getAdapter", () => {
  it("returns the Teamtailor adapter for TEAMTAILOR", () => {
    expect(getAdapter("TEAMTAILOR")).toBe(teamtailorAdapter);
  });

  const withoutAdapter = Object.values(SourceType).filter((source) => !(source in adapters));

  it("has at least one source type still waiting for an adapter", () => {
    expect(withoutAdapter).toContain("TALENTECH");
  });

  it.each(withoutAdapter)(
    "throws a clear error for %s, which has no adapter yet",
    (source) => {
      expect(() => getAdapter(source)).toThrow(`No adapter for source "${source}" yet`);
    },
  );
});

describe("adapters", () => {
  it("files each adapter under its own name", () => {
    for (const [source, adapter] of Object.entries(adapters)) {
      expect(adapter?.name).toBe(source);
    }
  });

  it("only uses real source types", () => {
    const known = Object.values(SourceType) as string[];
    for (const source of Object.keys(adapters)) expect(known).toContain(source);
  });

  it("matches the sources the company sync accepts", () => {
    expect(Object.keys(adapters).sort()).toEqual([...SUPPORTED_SOURCES].sort());
  });
});
