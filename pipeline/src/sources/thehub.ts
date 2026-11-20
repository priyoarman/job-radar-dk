import { z } from "zod";
import type { HttpClient } from "../lib/http";
import { assertAllowedByRobots } from "../lib/robots";
import { type SourceAdapter, normalizedJobSchema } from "./types";

export const THEHUB_MAX_PAGES = 10;

const SEARCH_PARAMS = ["search", "countryCode", "sorting"] as const;

const pageSchema = z.object({
  jobs: z.object({
    pages: z.number().int().nonnegative(),
    docs: z.array(z.unknown()),
  }),
});

const jobSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string(),
  isRemote: z.boolean().nullish(),
  location: z.object({ address: z.string().nullish(), locality: z.string().nullish() }).nullish(),
  company: z.object({ name: z.string().nullish() }).nullish(),
});

export function apiUrl(searchUrl: string, page: number): string {
  const link = new URL(searchUrl);
  const api = new URL("/api/v2/jobsandfeatured", link.origin);
  for (const name of SEARCH_PARAMS) {
    const value = link.searchParams.get(name);
    if (value) api.searchParams.set(name, value);
  }
  api.searchParams.set("page", String(page));
  return api.toString();
}

export function parseTheHubPage(data: unknown): { pages: number; jobs: unknown[] } {
  const result = pageSchema.safeParse(data);
  if (!result.success) throw new Error("The Hub response has no jobs list; got a different document");
  return { pages: result.data.jobs.pages, jobs: result.data.jobs.docs };
}

async function fetchAllPages(searchUrl: string, http: HttpClient): Promise<unknown[]> {
  await assertAllowedByRobots(http, apiUrl(searchUrl, 1));
  const jobs: unknown[] = [];
  let pages = 1;
  for (let page = 1; page <= Math.min(pages, THEHUB_MAX_PAGES); page++) {
    const result = parseTheHubPage(await http.json(apiUrl(searchUrl, page)));
    pages = result.pages;
    jobs.push(...result.jobs);
  }
  return jobs;
}

export const theHubAdapter: SourceAdapter<unknown> = {
  name: "THEHUB",

  fetchJobs(company, http) {
    return fetchAllPages(company.sourceKey, http);
  },

  normalize(raw, company) {
    const job = jobSchema.parse(raw);
    const location = job.location?.address?.trim() || job.location?.locality?.trim() || null;
    return normalizedJobSchema.parse({
      externalId: job.id,
      title: job.title,
      company: job.company?.name?.trim() || company.name,
      location,
      remoteType: job.isRemote ? "remote" : null,
      description: "",
      url: `https://thehub.io/jobs/${encodeURIComponent(job.id)}`,
      postedAt: null,
    });
  },
};
