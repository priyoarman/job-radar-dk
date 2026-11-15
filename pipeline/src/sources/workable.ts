import { z } from "zod";
import { htmlToText } from "../lib/html";
import { type SourceAdapter, normalizedJobSchema } from "./types";

const accountSchema = z.object({ jobs: z.array(z.unknown()) });

const jobSchema = z.object({
  shortcode: z.string(),
  title: z.string(),
  url: z.string(),
  city: z.string().nullish(),
  country: z.string().nullish(),
  locations: z
    .array(z.object({ city: z.string().nullish(), country: z.string().nullish(), hidden: z.boolean().nullish() }))
    .nullish(),
  telecommuting: z.boolean().nullish(),
  published_on: z.string().nullish(),
  description: z.string().nullish(),
});

export type WorkableJob = z.infer<typeof jobSchema>;

export function accountUrl(sourceKey: string): string {
  return `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(sourceKey.trim())}?details=true`;
}

export function parseWorkableAccount(data: unknown): unknown[] {
  const result = accountSchema.safeParse(data);
  if (!result.success) throw new Error("Workable response has no jobs list; got a different document");
  return result.data.jobs;
}

const place = (city: string | null | undefined, country: string | null | undefined) =>
  [city?.trim(), country?.trim()].filter(Boolean).join(", ");

function formatLocation(job: WorkableJob): string | null {
  const visible = (job.locations ?? []).filter((l) => !l.hidden).map((l) => place(l.city, l.country));
  const places = visible.length > 0 ? visible : [place(job.city, job.country)];
  const unique = [...new Set(places.filter(Boolean))];
  return unique.length > 0 ? unique.join("; ") : null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const workableAdapter: SourceAdapter<unknown> = {
  name: "WORKABLE",

  async fetchJobs(company, http) {
    return parseWorkableAccount(await http.json(accountUrl(company.sourceKey)));
  },

  normalize(raw, company) {
    const job = jobSchema.parse(raw);
    return normalizedJobSchema.parse({
      externalId: job.shortcode,
      title: job.title,
      company: company.name,
      location: formatLocation(job),
      remoteType: job.telecommuting ? "remote" : null,
      description: htmlToText(job.description ?? ""),
      url: job.url,
      postedAt: parseDate(job.published_on),
    });
  },
};
