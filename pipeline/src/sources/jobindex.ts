import * as cheerio from "cheerio";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { htmlToText } from "../lib/html";
import { assertAllowedByRobots } from "../lib/robots";
import { type SourceAdapter, normalizedJobSchema } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

const itemSchema = z.object({
  title: z.string(),
  link: z.string(),
  guid: z.union([z.string(), z.object({ "#text": z.string() })]).optional(),
  description: z.string().optional(),
  pubDate: z.string().optional(),
});

export type JobindexItem = z.infer<typeof itemSchema>;

export type JobindexSearch = { feedUrl: string; maxAgeDays: number | null };

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (tagName) => tagName === "item" || tagName === "category",
});

export function jobindexSearch(searchUrl: string): JobindexSearch {
  const url = new URL(searchUrl);
  const q = url.searchParams.get("q")?.trim();
  if (!q) throw new Error(`Jobindex search URL has no q= search words: ${searchUrl}`);
  const jobage = Number(url.searchParams.get("jobage"));
  const feed = new URL("/jobsoegning.rss", url.origin);
  feed.searchParams.set("q", q);
  return { feedUrl: feed.toString(), maxAgeDays: Number.isInteger(jobage) && jobage > 0 ? jobage : null };
}

export function parseJobindexFeed(xml: string): unknown[] {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(`Jobindex feed is not valid XML (line ${validation.err.line}): ${validation.err.msg}`);
  }
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: unknown[] } | "" } };
  const channel = doc.rss?.channel;
  if (channel === undefined) throw new Error("Jobindex feed has no <rss><channel>; got a different document");
  return channel === "" ? [] : (channel.item ?? []);
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function withinAge(items: readonly unknown[], maxAgeDays: number | null, now: Date): unknown[] {
  if (maxAgeDays === null) return [...items];
  const cutoff = now.getTime() - (maxAgeDays + 1) * DAY_MS;
  return items.filter((raw) => {
    const posted = parseDate(itemSchema.safeParse(raw).data?.pubDate);
    return posted === null || posted.getTime() >= cutoff;
  });
}

function decode(value: string): string {
  return cheerio.load(value).text();
}

function idFrom(item: JobindexItem): string {
  const guid = typeof item.guid === "string" ? item.guid : item.guid?.["#text"];
  const source = guid?.trim() || item.link.trim();
  return source.split("/").filter(Boolean).at(-1) ?? source;
}

export const jobindexAdapter: SourceAdapter<unknown> = {
  name: "JOBINDEX",

  async fetchJobs(company, http) {
    const { feedUrl, maxAgeDays } = jobindexSearch(company.sourceKey);
    await assertAllowedByRobots(http, feedUrl);
    return withinAge(parseJobindexFeed(await http.text(feedUrl)), maxAgeDays, new Date());
  },

  normalize(raw, company) {
    const item = itemSchema.parse(raw);
    const $ = cheerio.load(decode(item.description ?? ""));
    const clean = (text: string) => text.replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
    const shortTitle = clean($("h4").first().text());
    const fullTitle = clean(decode(item.title));
    const prefix = `${shortTitle}, `;
    const employer = shortTitle && fullTitle.startsWith(prefix) ? fullTitle.slice(prefix.length) : null;
    const places = $(".jix_robotjob--area")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    $("h4, img, .jobad-element-area").remove();
    return normalizedJobSchema.parse({
      externalId: idFrom(item),
      title: employer ? shortTitle : fullTitle,
      company: employer || company.name,
      location: places.length > 0 ? [...new Set(places)].join("; ") : null,
      remoteType: null,
      description: htmlToText($.html()),
      url: item.link.trim(),
      postedAt: parseDate(item.pubDate),
    });
  },
};
