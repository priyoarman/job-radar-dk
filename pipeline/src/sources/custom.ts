import * as cheerio from "cheerio";
import { z } from "zod";
import { errorMessage } from "../lib/errors";
import { type HttpClient, HttpError } from "../lib/http";
import { htmlToText } from "../lib/html";
import { log } from "../lib/logger";
import { RobotsDisallowedError, assertAllowedByRobots } from "../lib/robots";
import { type NormalizedJob, type SourceAdapter, normalizedJobSchema } from "./types";

export const MAX_JOBS = 40;
export const PAUSE_MS = 1_500;

const JOB_SEGMENTS = new Set([
  "job",
  "jobs",
  "jobopslag",
  "stilling",
  "stillinger",
  "ledige-stillinger",
  "vacancy",
  "vacancies",
  "position",
  "positions",
  "opening",
  "openings",
]);

export type CareerPage = { url: string; html: string };

const pageSchema = z.object({ url: z.string(), html: z.string() });

type JsonObject = Record<string, unknown>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (text: string) => text.replace(/\s+/g, " ").trim();

function withoutHash(url: URL): string {
  const copy = new URL(url);
  copy.hash = "";
  return copy.href;
}

export function jobLinks(html: string, pageUrl: string, max: number = MAX_JOBS): string[] {
  const $ = cheerio.load(html);
  const page = new URL(pageUrl);
  const links: string[] = [];
  $("a[href]").each((_, a) => {
    let url: URL;
    try {
      url = new URL($(a).attr("href") ?? "", page);
    } catch {
      return;
    }
    if (url.host !== page.host || !/^https?:$/.test(url.protocol)) return;
    const segments = url.pathname.split("/").filter(Boolean);
    const at = segments.findIndex((s) => JOB_SEGMENTS.has(s.toLowerCase()));
    if (at === -1 || at === segments.length - 1) return;
    const href = withoutHash(url);
    if (href !== withoutHash(page) && !links.includes(href)) links.push(href);
  });
  return links.slice(0, max);
}

const isGone = (error: unknown) =>
  error instanceof RobotsDisallowedError || (error instanceof HttpError && (error.status === 404 || error.status === 410));

export async function fetchCareerPages(sourceKey: string, http: HttpClient, pauseMs: number = PAUSE_MS): Promise<CareerPage[]> {
  const listUrl = new URL(sourceKey.trim()).href;
  await assertAllowedByRobots(http, listUrl);
  const links = jobLinks(await http.text(listUrl), listUrl);

  const pages: CareerPage[] = [];
  for (const url of links) {
    await sleep(pauseMs);
    try {
      await assertAllowedByRobots(http, url);
      pages.push({ url, html: await http.text(url) });
    } catch (error) {
      if (!isGone(error)) throw error;
      log.warn("custom.job-skipped", { url, error: errorMessage(error) });
    }
  }
  return pages;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasType(node: JsonObject, type: string): boolean {
  return asArray(node["@type"]).some((t) => t === type);
}

export function findJobPosting(html: string): JsonObject | null {
  const $ = cheerio.load(html);
  const queue: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, script) => {
    try {
      queue.push(JSON.parse($(script).text()));
    } catch {
      return;
    }
  });
  while (queue.length > 0) {
    const node = queue.shift();
    if (Array.isArray(node)) queue.push(...node);
    else if (isObject(node)) {
      if (hasType(node, "JobPosting")) return node;
      queue.push(...asArray(node["@graph"]));
    }
  }
  return null;
}

const text = (value: unknown) => (typeof value === "string" ? clean(value) : "");

function placeName(place: unknown): string {
  if (!isObject(place)) return text(place);
  const address = place.address;
  if (!isObject(address)) return text(address) || text(place.name);
  return [text(address.addressLocality), text(isObject(address.addressCountry) ? address.addressCountry.name : address.addressCountry)]
    .filter(Boolean)
    .join(", ");
}

function richText(value: unknown): string {
  const once = htmlToText(text(value) ? String(value) : "");
  return /<[a-z][^>]*>/i.test(once) ? htmlToText(once) : once;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

type PageJob = Omit<NormalizedJob, "company" | "externalId" | "url">;

function fromJsonLd(posting: JsonObject): PageJob {
  const places = [...new Set(asArray(posting.jobLocation).map(placeName).filter(Boolean))];
  const remote = asArray(posting.jobLocationType).some((t) => t === "TELECOMMUTE");
  return {
    title: text(posting.title),
    location: places.length > 0 ? places.join("; ") : null,
    remoteType: remote ? "remote" : null,
    description: richText(posting.description),
    postedAt: parseDate(posting.datePosted),
  };
}

function fromHtml(html: string): PageJob {
  const $ = cheerio.load(html);
  const title =
    clean($("h1").first().text()) || clean($('meta[property="og:title"]').attr("content") ?? "") || clean($("title").first().text());
  const body = $("main").first().length ? $("main").first() : $("article").first().length ? $("article").first() : $("body");
  body.find("script, style, noscript, nav, header, footer, aside, form, h1").remove();
  return {
    title,
    location: null,
    remoteType: null,
    description: htmlToText(body.html() ?? ""),
    postedAt: parseDate($('meta[property="article:published_time"]').attr("content")),
  };
}

export function parseJobPage(html: string): PageJob {
  const posting = findJobPosting(html);
  return posting ? fromJsonLd(posting) : fromHtml(html);
}

export const customAdapter: SourceAdapter<unknown> = {
  name: "CUSTOM",

  async fetchJobs(company, http) {
    return fetchCareerPages(company.sourceKey, http);
  },

  normalize(raw, company) {
    const page = pageSchema.parse(raw);
    return normalizedJobSchema.parse({
      ...parseJobPage(page.html),
      externalId: page.url,
      company: company.name,
      url: page.url,
    });
  },
};
