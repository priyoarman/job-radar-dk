import * as cheerio from "cheerio";
import { z } from "zod";
import type { HttpClient } from "../lib/http";
import { assertAllowedByRobots } from "../lib/robots";
import { type SourceAdapter, normalizedJobSchema } from "./types";

export const MAX_PAGES = 10;
export const PAUSE_MS = 1_500;

const rowSchema = z.object({
  title: z.string(),
  path: z.string(),
  location: z.string().nullable(),
  date: z.string().nullable(),
});

export type SuccessFactorsRow = z.infer<typeof rowSchema>;

export type SearchPage = { rows: SuccessFactorsRow[]; last: number | null; total: number | null };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (text: string) => text.replace(/\s+/g, " ").trim();

export function siteOrigin(sourceKey: string): string {
  return new URL(sourceKey.trim()).origin;
}

export function searchUrl(origin: string, startRow: number): string {
  const params = new URLSearchParams({ q: "", locationsearch: "Denmark" });
  if (startRow > 0) params.set("startrow", String(startRow));
  return `${origin}/search/?${params.toString()}`;
}

export function parseSearchPage(html: string): SearchPage {
  const $ = cheerio.load(html);
  const rows: SuccessFactorsRow[] = [];
  $("tr.data-row").each((_, row) => {
    const link = $(row).find("a.jobTitle-link").first();
    const path = link.attr("href");
    const title = clean(link.text());
    if (!path || !title) return;
    const location = $(row).find(".jobLocation").first().clone();
    location.find("small").remove();
    const date = clean($(row).find(".jobDate").first().text());
    rows.push({ title, path, location: clean(location.text()) || null, date: date || null });
  });

  const label = clean($(".paginationLabel").first().text());
  const banner =
    label.match(/(\d+)\s*[–-]\s*(\d+)\D+(\d+)/) ?? clean($("body").text()).match(/Results\s*(\d+)\s*[–-]\s*(\d+)\s*of\s*(\d+)/);
  return {
    rows,
    last: banner ? Number(banner[2]) : null,
    total: banner ? Number(banner[3]) : null,
  };
}

export async function fetchDenmarkRows(
  origin: string,
  http: HttpClient,
  pauseMs: number = PAUSE_MS,
): Promise<SuccessFactorsRow[]> {
  await assertAllowedByRobots(http, searchUrl(origin, 0));
  const rows: SuccessFactorsRow[] = [];
  let startRow = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(pauseMs);
    const result = parseSearchPage(await http.text(searchUrl(origin, startRow)));
    if (page === 0 && result.rows.length === 0 && result.total === null) {
      throw new Error(`No job rows on ${searchUrl(origin, 0)}; the site may use the newer search page`);
    }
    rows.push(...result.rows);
    if (result.rows.length === 0 || result.last === null || result.total === null || result.last >= result.total) break;
    startRow = result.last;
  }
  return rows;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, maj: 4, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, dec: 11,
};

export function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const dayMonthYear = /^(\d{1,2})\.?\s+([a-zæøå]+)\.?\s+(\d{4})$/i.exec(value.trim());
  if (dayMonthYear) {
    const month = MONTHS[dayMonthYear[2]!.slice(0, 3).toLowerCase()];
    if (month === undefined) return null;
    return new Date(Date.UTC(Number(dayMonthYear[3]), month, Number(dayMonthYear[1])));
  }
  const date = new Date(`${value} UTC`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const successFactorsAdapter: SourceAdapter<unknown> = {
  name: "SUCCESSFACTORS",

  async fetchJobs(company, http) {
    return fetchDenmarkRows(siteOrigin(company.sourceKey), http);
  },

  normalize(raw, company) {
    const row = rowSchema.parse(raw);
    const id = /\/(\d+)\/?$/.exec(row.path)?.[1];
    return normalizedJobSchema.parse({
      externalId: id ?? row.path,
      title: row.title,
      company: company.name,
      location: row.location,
      remoteType: null,
      description: "",
      url: new URL(row.path, siteOrigin(company.sourceKey)).toString(),
      postedAt: parseDate(row.date),
    });
  },
};
