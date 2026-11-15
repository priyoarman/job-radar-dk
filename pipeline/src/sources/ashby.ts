import { z } from "zod";
import { htmlToText } from "../lib/html";
import { type NormalizedJob, type SourceAdapter, normalizedJobSchema } from "./types";

const boardSchema = z.object({ jobs: z.array(z.unknown()) });

const jobSchema = z.object({
  id: z.string(),
  title: z.string(),
  jobUrl: z.string(),
  isListed: z.boolean().nullish(),
  location: z.string().nullish(),
  secondaryLocations: z.array(z.object({ location: z.string().nullish() })).nullish(),
  address: z
    .object({ postalAddress: z.object({ addressCountry: z.string().nullish() }).nullish() })
    .nullish(),
  workplaceType: z.string().nullish(),
  isRemote: z.boolean().nullish(),
  publishedAt: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
});

export type AshbyJob = z.infer<typeof jobSchema>;

const WORKPLACE_TYPES: Record<string, NormalizedJob["remoteType"]> = {
  OnSite: "onsite",
  Hybrid: "hybrid",
  Remote: "remote",
};

export function boardUrl(sourceKey: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(sourceKey.trim())}`;
}

export function parseAshbyBoard(data: unknown): unknown[] {
  const result = boardSchema.safeParse(data);
  if (!result.success) throw new Error("Ashby response has no jobs list; got a different document");
  return result.data.jobs.filter((job) => (job as { isListed?: unknown }).isListed !== false);
}

function formatLocation(job: AshbyJob): string | null {
  const country = job.address?.postalAddress?.addressCountry?.trim();
  const primary = job.location?.trim();
  const needsCountry = primary && country && !primary.includes(",") && !primary.toLowerCase().includes(country.toLowerCase());
  const first = needsCountry ? `${primary}, ${country}` : primary || country;
  const secondary = (job.secondaryLocations ?? []).map((s) => s.location?.trim());
  const unique = [...new Set([first, ...secondary].filter(Boolean))];
  return unique.length > 0 ? unique.join("; ") : null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const ashbyAdapter: SourceAdapter<unknown> = {
  name: "ASHBY",

  async fetchJobs(company, http) {
    return parseAshbyBoard(await http.json(boardUrl(company.sourceKey)));
  },

  normalize(raw, company) {
    const job = jobSchema.parse(raw);
    return normalizedJobSchema.parse({
      externalId: job.id,
      title: job.title,
      company: company.name,
      location: formatLocation(job),
      remoteType: WORKPLACE_TYPES[job.workplaceType ?? ""] ?? null,
      description: htmlToText(job.descriptionHtml ?? ""),
      url: job.jobUrl,
      postedAt: parseDate(job.publishedAt),
    });
  },
};
