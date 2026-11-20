import { z } from "zod";
import { type SourceAdapter, normalizedJobSchema } from "./types";

export const LINKEDIN_ACTOR = "valig/linkedin-jobs-scraper";
export const LINKEDIN_RESULT_LIMIT = 100;

const DATE_POSTED = ["r86400", "r604800", "r2592000"] as const;

const jobSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  companyName: z.string().nullish(),
  location: z.string().nullish(),
  description: z.string().nullish(),
  postedDate: z.string().nullish(),
});

export type LinkedInSearchInput = {
  keywords: string;
  location?: string;
  datePosted?: (typeof DATE_POSTED)[number];
  limit: number;
};

export function searchInput(searchUrl: string): LinkedInSearchInput {
  const params = new URL(searchUrl).searchParams;
  const keywords = params.get("keywords")?.trim();
  if (!keywords) throw new Error(`LinkedIn search URL has no keywords: ${searchUrl}`);
  const location = params.get("location")?.trim();
  const datePosted = DATE_POSTED.find((value) => value === params.get("f_TPR"));
  return {
    keywords,
    ...(location ? { location } : {}),
    ...(datePosted ? { datePosted } : {}),
    limit: LINKEDIN_RESULT_LIMIT,
  };
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const linkedinAdapter: SourceAdapter<unknown> = {
  name: "LINKEDIN",

  async fetchJobs(company, _http, deps) {
    if (!deps?.runActor) throw new Error("APIFY_TOKEN is not set, so the LinkedIn search cannot run");
    return deps.runActor(LINKEDIN_ACTOR, searchInput(company.sourceKey));
  },

  normalize(raw, company) {
    const job = jobSchema.parse(raw);
    const id = String(job.id).trim();
    return normalizedJobSchema.parse({
      externalId: id,
      title: job.title,
      company: job.companyName?.trim() || company.name,
      location: job.location?.trim() || null,
      remoteType: null,
      description: job.description ?? "",
      url: `https://www.linkedin.com/jobs/view/${encodeURIComponent(id)}`,
      postedAt: parseDate(job.postedDate),
    });
  },
};
