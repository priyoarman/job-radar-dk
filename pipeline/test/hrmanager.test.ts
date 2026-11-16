import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../src/lib/http";
import {
  MAX_PAGES,
  PAGE_SIZE,
  PAUSE_MS,
  customerAlias,
  fetchPositions,
  hrManagerAdapter,
  parseDotNetDate,
  parsePositionList,
  positionListUrl,
} from "../src/sources/hrmanager";
import { normalizeJobs } from "../src/sources/normalize";

type List = { Items: Record<string, unknown>[]; PositionCountList: number };

const fixture = (name: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/hrmanager", name), "utf8"));
const bec = () => fixture("bec.json") as List;
const becCompany = { slug: "bec", name: "BEC Financial Technologies", sourceKey: "bec" };
const byId = (id: number) => bec().Items.find((item) => item.Id === id)!;

function fakeHttp(...responses: unknown[]) {
  const json = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) json.mockRejectedValueOnce(response);
    else json.mockResolvedValueOnce(response);
  }
  return { text: vi.fn(), json };
}

const listOf = (items: unknown[], total: number) => ({ ...bec(), Items: items, PositionCountList: total });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("urls", () => {
  it("asks the documented API for 100 positions with their ads", () => {
    expect(positionListUrl("bec", 0)).toBe(
      "https://recruiter-api.hr-manager.net/jobportal.svc/bec/positionlist/json/?incads=1&take=100",
    );
    expect(positionListUrl("bec", 100)).toBe(
      "https://recruiter-api.hr-manager.net/jobportal.svc/bec/positionlist/json/?incads=1&take=100&skip=100",
    );
  });

  it.each(["bec", " bec "])("accepts the customer alias %j", (key) => {
    expect(customerAlias(key)).toBe("bec");
  });

  it.each(["https://candidate.hr-manager.net/Agent/Subscription.aspx?cid=307", "", "b e c"])("rejects %j as an alias", (key) => {
    expect(() => customerAlias(key)).toThrow("customer alias");
  });
});

describe("parsePositionList", () => {
  it("reads every position of the real BEC list", () => {
    expect(parsePositionList(bec()).Items).toHaveLength(38);
  });

  it("returns an empty list for a customer without open positions", () => {
    expect(parsePositionList(fixture("empty.json")).Items).toEqual([]);
  });

  it("fails with HR Manager's own message when it reports an error", () => {
    expect(() => parsePositionList(fixture("unknown-alias.json"))).toThrow(/HR Manager answered with error 1: Value cannot be null/);
  });

  it("fails clearly on a different document", () => {
    expect(() => parsePositionList({ hello: "world" })).toThrow("HR Manager response has no Items list");
  });
});

describe("fetchPositions", () => {
  it("reads everything in one request when it fits on one page", async () => {
    const http = fakeHttp(bec());
    await expect(fetchPositions("bec", http, 0)).resolves.toHaveLength(38);
    expect(http.json).toHaveBeenCalledTimes(1);
    expect(http.json.mock.calls[0]?.[0]).toBe(positionListUrl("bec", 0));
  });

  it("skips ahead by the positions already read until it has the total", async () => {
    const items = bec().Items;
    const http = fakeHttp(listOf(Array(PAGE_SIZE).fill(items[0]), 138), listOf(items, 138));
    await expect(fetchPositions("bec", http, 0)).resolves.toHaveLength(138);
    expect(http.json.mock.calls.map(([url]) => url)).toEqual([positionListUrl("bec", 0), positionListUrl("bec", 100)]);
  });

  it(`pauses ${PAUSE_MS} ms between pages`, async () => {
    vi.useFakeTimers();
    try {
      const items = bec().Items;
      const http = fakeHttp(listOf(Array(PAGE_SIZE).fill(items[0]), 138), listOf(items, 138));
      const promise = fetchPositions("bec", http);
      await vi.advanceTimersByTimeAsync(0);
      expect(http.json).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(PAUSE_MS);
      await expect(promise).resolves.toHaveLength(138);
    } finally {
      vi.useRealTimers();
    }
  });

  it(`never asks for more than ${MAX_PAGES} pages`, async () => {
    const full = listOf(Array(PAGE_SIZE).fill(bec().Items[0]), 10_000);
    const http = fakeHttp(...Array(MAX_PAGES + 2).fill(full));
    await fetchPositions("bec", http, 0);
    expect(http.json).toHaveBeenCalledTimes(MAX_PAGES);
  });

  it("explains an unknown alias instead of a bare HTTP 400", async () => {
    const http = fakeHttp(new HttpError(positionListUrl("ewii", 0), 400));
    await expect(fetchPositions("ewii", http, 0)).rejects.toThrow('HR Manager does not know the customer alias "ewii"');
  });

  it("passes other HTTP errors through unchanged", async () => {
    const http = fakeHttp(new HttpError(positionListUrl("bec", 0), 503));
    await expect(fetchPositions("bec", http, 0)).rejects.toThrow("failed with HTTP 503");
  });
});

describe("parseDotNetDate", () => {
  it.each([
    ["/Date(1794227672000+0100)/", new Date("2026-11-09T12:34:32Z")],
    ["/Date(1794227672000)/", new Date("2026-11-09T12:34:32Z")],
    ["/Date(-62135596800000)/", null],
    ["2026-11-09", null],
    [null, null],
  ])("reads %j as %s", (value, expected) => {
    expect(parseDotNetDate(value)).toEqual(expected);
  });
});

describe("hrManagerAdapter.normalize", () => {
  it("maps a real position to a NormalizedJob", () => {
    const job = hrManagerAdapter.normalize(byId(71567), becCompany);
    expect(job).toMatchObject({
      externalId: "71567",
      title: "AI engineer (senior)",
      company: "BEC Financial Technologies",
      location: "Warsaw",
      remoteType: null,
      url: "https://candidate.hr-manager.net/ApplicationInit.aspx?cid=1017&ProjectId=71567&DepartmentId=9752&MediaId=5",
      postedAt: new Date("2026-11-09T12:34:32Z"),
    });
    expect(job.description).toMatch(/^You will join our AI Hub\./);
    expect(job.description).not.toMatch(/<[a-z]/i);
  });

  it("matches the snapshot for the first BEC position", () => {
    expect(hrManagerAdapter.normalize(bec().Items[0], becCompany)).toMatchSnapshot();
  });

  it("lists every location of a multi-location job", () => {
    expect(hrManagerAdapter.normalize(byId(71662), becCompany).location).toBe("Roskilde; Warsaw");
  });

  it("falls back to the single location, then the work place", () => {
    const position = { ...byId(71701), PositionLocationMultiSelection: [] };
    expect(hrManagerAdapter.normalize(position, becCompany).location).toBe("Aalborg");
    const workPlace = { ...position, PositionLocation: null, WorkPlace: "Ballerup" };
    expect(hrManagerAdapter.normalize(workPlace, becCompany).location).toBe("Ballerup");
  });

  it("uses the created date when there is no publish date", () => {
    const position = { ...byId(71567), Published: "/Date(-62135596800000)/" };
    expect(hrManagerAdapter.normalize(position, becCompany).postedAt).toEqual(new Date(1783064252000));
  });

  it("normalizes every real position with a unique id", () => {
    const items = bec().Items;
    const { jobs, skipped } = normalizeJobs(hrManagerAdapter, items, becCompany);
    expect(skipped).toBe(0);
    expect(new Set(jobs.map((j) => j.externalId)).size).toBe(items.length);
  });

  it("skips a broken position and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [first, second] = bec().Items;
    const { Name: _name, ...broken } = second!;
    const { jobs, skipped } = normalizeJobs(hrManagerAdapter, [first, broken], becCompany);
    expect(skipped).toBe(1);
    expect(jobs).toHaveLength(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/normalize\.skipped .*"source":"HRMANAGER"/);
  });
});
