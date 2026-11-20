import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../src/lib/http";
import { RobotsDisallowedError } from "../src/lib/robots";
import {
  type FetchCompaniesOptions,
  type FetchableCompany,
  type ProcessResult,
  fetchCompanies,
  intervalHoursFor,
  isFetchDue,
} from "../src/steps/fetchCompanies";

const T0 = new Date("2026-11-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(T0.getTime() - h * 60 * 60 * 1000);

const company = (slug: string, lastFetchedAt: Date | null = null): FetchableCompany => ({
  id: `id-${slug}`,
  slug,
  name: slug,
  source: "TEAMTAILOR",
  sourceKey: `https://${slug}.teamtailor.com`,
  baselineDoneAt: null,
  lastFetchedAt,
});

const ok: ProcessResult = { status: "OK", jobsFound: 5, jobsNew: 1, jobsPassed: 1, jobsClosed: 0 };

function options(overrides: Partial<FetchCompaniesOptions> = {}): FetchCompaniesOptions {
  return {
    minIntervalHours: 2.5,
    pauseMs: 1_000,
    now: () => T0,
    sleep: vi.fn().mockResolvedValue(undefined),
    processCompany: vi.fn().mockResolvedValue(ok),
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isFetchDue", () => {
  it.each<[Date | null, boolean, string]>([
    [null, true, "never fetched"],
    [hoursAgo(3), true, "fetched 3 h ago"],
    [hoursAgo(2.5), true, "fetched exactly 2.5 h ago"],
    [hoursAgo(2.4), false, "fetched 2.4 h ago"],
    [hoursAgo(0), false, "fetched just now"],
  ])("%s → %s (%s)", (lastFetchedAt, expected) => {
    expect(isFetchDue(lastFetchedAt, T0, 2.5)).toBe(expected);
  });
});

describe("intervalHoursFor", () => {
  it("checks company boards at the normal interval and LinkedIn searches about once a day", () => {
    expect(intervalHoursFor({ source: "TEAMTAILOR" }, 2.5)).toBe(2.5);
    expect(intervalHoursFor({ source: "LINKEDIN" }, 2.5)).toBe(23.5);
  });

  it("skips a LinkedIn search fetched 12 hours ago but runs one fetched 24 hours ago", async () => {
    const recent = { ...company("li-recent", hoursAgo(12)), source: "LINKEDIN" as const };
    const due = { ...company("li-due", hoursAgo(24)), source: "LINKEDIN" as const };
    const outcomes = await fetchCompanies([recent, due], options());
    expect(outcomes.map((o) => o.status)).toEqual(["SKIPPED_RECENT", "OK"]);
  });
});

describe("fetchCompanies", () => {
  it("processes every due company in order and returns one outcome each", async () => {
    const opts = options();
    const outcomes = await fetchCompanies([company("a"), company("b")], opts);
    expect(vi.mocked(opts.processCompany).mock.calls.map(([c]) => c.slug)).toEqual(["a", "b"]);
    expect(outcomes).toEqual([
      { companyId: "id-a", slug: "a", httpStatus: null, error: null, durationMs: 0, ...ok },
      { companyId: "id-b", slug: "b", httpStatus: null, error: null, durationMs: 0, ...ok },
    ]);
  });

  it("passes the run's time to processCompany", async () => {
    const opts = options();
    await fetchCompanies([company("a")], opts);
    expect(opts.processCompany).toHaveBeenCalledWith(expect.objectContaining({ slug: "a" }), T0);
  });

  it("skips a company fetched too recently, without fetching or pausing", async () => {
    const opts = options();
    const outcomes = await fetchCompanies([company("recent", hoursAgo(1))], opts);
    expect(opts.processCompany).not.toHaveBeenCalled();
    expect(opts.sleep).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ slug: "recent", status: "SKIPPED_RECENT", jobsFound: 0, durationMs: null });
  });

  it("pauses between fetches, but not before the first one", async () => {
    const opts = options();
    await fetchCompanies([company("a"), company("b"), company("c")], opts);
    expect(opts.sleep).toHaveBeenCalledTimes(2);
    expect(opts.sleep).toHaveBeenCalledWith(1_000);
  });

  it("does not pause for skipped companies", async () => {
    const opts = options();
    await fetchCompanies([company("skip1", hoursAgo(1)), company("a"), company("skip2", hoursAgo(1)), company("b")], opts);
    expect(opts.sleep).toHaveBeenCalledTimes(1);
  });

  it("keeps going after one company fails, and records the error", async () => {
    const processCompany = vi
      .fn()
      .mockResolvedValueOnce(ok)
      .mockRejectedValueOnce(new Error("feed exploded"))
      .mockResolvedValueOnce(ok);
    const outcomes = await fetchCompanies([company("a"), company("broken"), company("c")], options({ processCompany }));
    expect(outcomes.map((o) => o.status)).toEqual(["OK", "ERROR", "OK"]);
    expect(outcomes[1]).toMatchObject({ slug: "broken", error: "feed exploded", httpStatus: null, jobsFound: 0 });
  });

  it("includes the hidden cause of a network error", async () => {
    const processCompany = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND x") }));
    const [outcome] = await fetchCompanies([company("dns")], options({ processCompany }));
    expect(outcome?.error).toBe("fetch failed: getaddrinfo ENOTFOUND x");
  });

  it("records the HTTP status of a failed fetch", async () => {
    const processCompany = vi.fn().mockRejectedValue(new HttpError("https://x/jobs.rss", 404));
    const [outcome] = await fetchCompanies([company("gone")], options({ processCompany }));
    expect(outcome).toMatchObject({ status: "ERROR", httpStatus: 404, error: expect.stringContaining("404") });
  });

  it("skips a company whose page robots.txt forbids, without counting it as an error", async () => {
    const warn = vi.mocked(console.warn);
    const processCompany = vi.fn().mockRejectedValue(new RobotsDisallowedError("https://www.dr.dk/search/?q="));
    const [outcome] = await fetchCompanies([company("dr")], options({ processCompany }));
    expect(outcome).toMatchObject({ status: "SKIPPED_ROBOTS", httpStatus: null, error: expect.stringContaining("robots-disallowed") });
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^WARN fetch\.robots-disallowed .*"url":"https:\/\/www\.dr\.dk\/search\/\?q="/);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("measures how long each company took", async () => {
    const times = [T0, new Date(T0.getTime() + 750)];
    const now = vi.fn(() => times.shift() ?? T0);
    const [outcome] = await fetchCompanies([company("a")], options({ now }));
    expect(outcome?.durationMs).toBe(750);
  });

  it("passes through EMPTY and SUSPICIOUS_EMPTY results", async () => {
    const processCompany = vi
      .fn()
      .mockResolvedValueOnce({ ...ok, status: "EMPTY", jobsFound: 0 })
      .mockResolvedValueOnce({ ...ok, status: "SUSPICIOUS_EMPTY", jobsFound: 0 });
    const outcomes = await fetchCompanies([company("a"), company("b")], options({ processCompany }));
    expect(outcomes.map((o) => o.status)).toEqual(["EMPTY", "SUSPICIOUS_EMPTY"]);
  });

  it("returns an empty list when there are no companies", async () => {
    await expect(fetchCompanies([], options())).resolves.toEqual([]);
  });
});
