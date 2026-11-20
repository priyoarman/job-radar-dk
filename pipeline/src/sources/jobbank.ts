import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { log } from "../lib/logger";
import { assertAllowedByRobots } from "../lib/robots";
import { type SourceAdapter, normalizedJobSchema } from "./types";

export const JOBBANK_LOOKBACK_DAYS = 7;
export const JOBBANK_FEED_LIMIT = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
const SEARCH_PARAMS = ["key", "antikey", "virk"] as const;
const PLACE =
  /^(Storkøbenhavn|Bornholm|Fyn|Øresundsregionen|Grønland|Færøerne|Sydsjælland & Øer|\p{L}*jylland|\p{L}*sjælland|Udlandet)( \(.+\))?$/u;

const itemSchema = z.object({
  title: z.string(),
  link: z.string(),
  description: z.string().optional(),
  pubDate: z.string().optional(),
});

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, isArray: (tagName) => tagName === "item" });

export function danishDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("da-DK", {
    timeZone: "Europe/Copenhagen",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}.${part("month")}.${part("year")}`;
}

export function feedUrl(searchUrl: string, now: Date): string {
  const link = new URL(searchUrl);
  if (!link.searchParams.get("key")?.trim()) throw new Error(`Jobbank search URL has no key= search words: ${searchUrl}`);
  const feed = new URL("/job/rss/", link.origin);
  for (const name of SEARCH_PARAMS) {
    const value = link.searchParams.get(name)?.trim();
    if (value) feed.searchParams.set(name, value);
  }
  const since = link.searchParams.get("oprettet")?.trim() || danishDate(new Date(now.getTime() - JOBBANK_LOOKBACK_DAYS * DAY_MS));
  feed.searchParams.set("oprettet", since);
  return feed.toString();
}

export function parseJobbankFeed(xml: string): unknown[] {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(`Jobbank feed is not valid XML (line ${validation.err.line}): ${validation.err.msg}`);
  }
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: unknown[] } | "" } };
  const channel = doc.rss?.channel;
  if (channel === undefined) throw new Error("Jobbank feed has no <rss><channel>; got a different document");
  return channel === "" ? [] : (channel.item ?? []);
}

export function splitDescription(description: string): { employer: string | null; places: string[] } {
  const text = description.replace(/\s*\(Ansøgningsfrist:[^)]*\)\s*$/, "").trim();
  const at = text.indexOf(" hos ");
  if (at === -1) return { employer: null, places: [] };
  const parts = text.slice(at + " hos ".length).split(", ");
  const places: string[] = [];
  while (parts.length > 1 && PLACE.test(parts.at(-1)!.trim())) places.unshift(parts.pop()!.trim());
  return { employer: parts.join(", ").trim() || null, places };
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const jobbankAdapter: SourceAdapter<unknown> = {
  name: "JOBBANK",

  async fetchJobs(company, http) {
    const url = feedUrl(company.sourceKey, new Date());
    await assertAllowedByRobots(http, url);
    const items = parseJobbankFeed(await http.text(url));
    if (items.length >= JOBBANK_FEED_LIMIT) log.warn("jobbank.feed-full", { company: company.slug, items: items.length });
    return items;
  },

  normalize(raw, company) {
    const item = itemSchema.parse(raw);
    const link = item.link.trim();
    const id = /\/job\/(\d+)/.exec(link)?.[1] ?? link;
    const description = (item.description ?? "").replace(/\s+/g, " ").trim();
    const { employer, places } = splitDescription(description);
    return normalizedJobSchema.parse({
      externalId: id,
      title: item.title.replace(/\s+/g, " ").trim(),
      company: employer || company.name,
      location: places.length > 0 ? places.join("; ") : null,
      remoteType: null,
      description,
      url: link,
      postedAt: parseDate(item.pubDate),
    });
  },
};
