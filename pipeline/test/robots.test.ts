import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../src/lib/http";
import { ROBOTS_TTL_MS, RobotsDisallowedError, assertAllowedByRobots, isPathAllowed, robotsTxtFor } from "../src/lib/robots";

const realRobots = readFileSync(resolve(import.meta.dirname, "fixtures/successfactors/robots-allowed.txt"), "utf8");

describe("isPathAllowed", () => {
  it.each([
    ["/search/?q=&locationsearch=Denmark", true],
    ["/job/Ballerup-Full-Stack-Cloud-Developer-Capi/1454132133/", true],
    ["/services/recruiting/v1/jobs", false],
    ["/services/rss/job/?locale=en_US", false],
    ["/talentcommunity/subscribe", false],
    ["/errorpage", false],
  ])("real SuccessFactors robots.txt: %s → %s", (path, expected) => {
    expect(isPathAllowed(realRobots, path)).toBe(expected);
  });

  it("allows everything when robots.txt is empty", () => {
    expect(isPathAllowed("", "/anything")).toBe(true);
  });

  it("follows a group written for our own bot over the * group", () => {
    const robots = "User-agent: *\nDisallow: /\n\nUser-agent: JobRadarDK\nAllow: /search/\nDisallow: /";
    expect(isPathAllowed(robots, "/search/?q=")).toBe(true);
    expect(isPathAllowed(robots, "/job/1/")).toBe(false);
  });

  it("lets the longest matching rule win, and Allow win a tie", () => {
    const robots = "User-agent: *\nDisallow: /search\nAllow: /search/public\nDisallow: /a\nAllow: /a";
    expect(isPathAllowed(robots, "/search/private")).toBe(false);
    expect(isPathAllowed(robots, "/search/public/1")).toBe(true);
    expect(isPathAllowed(robots, "/a")).toBe(true);
  });

  it("understands * and $ in patterns", () => {
    const robots = "User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?sessionid=";
    expect(isPathAllowed(robots, "/files/cv.pdf")).toBe(false);
    expect(isPathAllowed(robots, "/files/cv.pdf?x=1")).toBe(true);
    expect(isPathAllowed(robots, "/search/?sessionid=1")).toBe(false);
  });

  it("ignores comments and blank Disallow lines", () => {
    expect(isPathAllowed("User-agent: * # everyone\nDisallow:\n# Disallow: /search/", "/search/")).toBe(true);
  });

  it("disallows everything for Disallow: /", () => {
    expect(isPathAllowed("User-agent: *\nDisallow: /", "/search/")).toBe(false);
  });
});

describe("assertAllowedByRobots", () => {
  const http = (text: () => Promise<string>) => ({ text: vi.fn(text), json: vi.fn() });

  it("reads robots.txt from the site's origin and passes when allowed", async () => {
    const client = http(async () => realRobots);
    await expect(assertAllowedByRobots(client, "https://careers.example.com/search/?q=")).resolves.toBeUndefined();
    expect(client.text).toHaveBeenCalledExactlyOnceWith("https://careers.example.com/robots.txt");
  });

  it("throws a robots-disallowed error when the path is blocked", async () => {
    const client = http(async () => "User-agent: *\nDisallow: /search/");
    const error = await assertAllowedByRobots(client, "https://careers.example.com/search/?q=").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RobotsDisallowedError);
    expect(String(error)).toContain("robots-disallowed");
  });

  it("treats a missing robots.txt (404) as allowed", async () => {
    const client = http(async () => {
      throw new HttpError("https://careers.example.com/robots.txt", 404);
    });
    await expect(assertAllowedByRobots(client, "https://careers.example.com/search/")).resolves.toBeUndefined();
  });

  it("does not guess when robots.txt cannot be read because of a server error", async () => {
    const client = http(async () => {
      throw new HttpError("https://careers.example.com/robots.txt", 503);
    });
    await expect(assertAllowedByRobots(client, "https://careers.example.com/search/")).rejects.toThrow("503");
  });
});

describe("robotsTxtFor cache", () => {
  const http = (text: (url: string) => Promise<string>) => ({ text: vi.fn(text), json: vi.fn() });
  const T0 = Date.parse("2026-11-16T12:00:00Z");

  it("reads robots.txt once per site and reuses it", async () => {
    const client = http(async () => realRobots);
    await assertAllowedByRobots(client, "https://a.example.com/search/", () => T0);
    await assertAllowedByRobots(client, "https://a.example.com/job/1/", () => T0 + 1_000);
    await robotsTxtFor(client, "https://b.example.com", () => T0);
    expect(client.text.mock.calls.map(([url]) => url)).toEqual([
      "https://a.example.com/robots.txt",
      "https://b.example.com/robots.txt",
    ]);
  });

  it(`reads it again once it is ${ROBOTS_TTL_MS / 3_600_000} hours old`, async () => {
    const client = http(async () => realRobots);
    await robotsTxtFor(client, "https://a.example.com", () => T0);
    await robotsTxtFor(client, "https://a.example.com", () => T0 + ROBOTS_TTL_MS - 1);
    expect(client.text).toHaveBeenCalledTimes(1);
    await robotsTxtFor(client, "https://a.example.com", () => T0 + ROBOTS_TTL_MS);
    expect(client.text).toHaveBeenCalledTimes(2);
  });

  it("remembers a missing robots.txt as allow-all", async () => {
    const client = http(async () => {
      throw new HttpError("https://a.example.com/robots.txt", 404);
    });
    await expect(robotsTxtFor(client, "https://a.example.com", () => T0)).resolves.toBe("");
    await robotsTxtFor(client, "https://a.example.com", () => T0);
    expect(client.text).toHaveBeenCalledTimes(1);
  });

  it("does not remember a server error, so the next check tries again", async () => {
    const client = http(async () => realRobots);
    client.text.mockRejectedValueOnce(new HttpError("https://a.example.com/robots.txt", 503));
    await expect(robotsTxtFor(client, "https://a.example.com", () => T0)).rejects.toThrow("503");
    await expect(robotsTxtFor(client, "https://a.example.com", () => T0)).resolves.toBe(realRobots);
    expect(client.text).toHaveBeenCalledTimes(2);
  });

  it("keeps a separate cache for each HTTP client", async () => {
    const first = http(async () => "User-agent: *\nDisallow: /");
    const second = http(async () => "");
    await expect(assertAllowedByRobots(first, "https://a.example.com/x", () => T0)).rejects.toThrow("robots-disallowed");
    await expect(assertAllowedByRobots(second, "https://a.example.com/x", () => T0)).resolves.toBeUndefined();
  });
});
