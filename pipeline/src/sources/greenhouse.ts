import * as cheerio from "cheerio";
import { z } from "zod";
import { htmlToText } from "../lib/html";
import { type NormalizedJob, type SourceAdapter, normalizedJobSchema } from "./types";

const boardSchema = z.object({ jobs: z.array(z.unknown()) });

const jobSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  absolute_url: z.string(),
  content: z.string().nullish(),
  first_published: z.string().nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  offices: z.array(z.object({ name: z.string().nullish(), location: z.string().nullish() })).nullish(),
});

export type GreenhouseJob = z.infer<typeof jobSchema>;

export function boardUrl(sourceKey: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(sourceKey.trim())}/jobs?content=true`;
}

export function parseGreenhouseBoard(data: unknown): unknown[] {
  const result = boardSchema.safeParse(data);
  if (!result.success) throw new Error("Greenhouse response has no jobs list; got a different document");
  return result.data.jobs;
}

function formatLocation(job: GreenhouseJob): string | null {
  const offices = (job.offices ?? []).map((o) => o.location?.trim() || o.name?.trim()).filter(Boolean);
  const places = offices.length > 0 ? offices : [job.location?.name?.trim()].filter(Boolean);
  const unique = [...new Set(places)];
  return unique.length > 0 ? unique.join("; ") : null;
}

function remoteTypeFrom(location: string | null | undefined): NormalizedJob["remoteType"] {
  if (!location) return null;
  if (/\bremote\b/i.test(location)) return "remote";
  if (/\bhybrid\b/i.test(location)) return "hybrid";
  return null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function decodeContent(content: string | null | undefined): string {
  if (!content) return "";
  return htmlToText(cheerio.load(content).text());
}

export const greenhouseAdapter: SourceAdapter<unknown> = {
  name: "GREENHOUSE",

  async fetchJobs(company, http) {
    return parseGreenhouseBoard(await http.json(boardUrl(company.sourceKey)));
  },

  normalize(raw, company) {
    const job = jobSchema.parse(raw);
    return normalizedJobSchema.parse({
      externalId: String(job.id),
      title: job.title,
      company: company.name,
      location: formatLocation(job),
      remoteType: remoteTypeFrom(job.location?.name),
      description: decodeContent(job.content),
      url: job.absolute_url,
      postedAt: parseDate(job.first_published),
    });
  },
};
