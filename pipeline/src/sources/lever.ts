import { z } from "zod";
import { htmlToText } from "../lib/html";
import { type NormalizedJob, type SourceAdapter, normalizedJobSchema } from "./types";

const postingSchema = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string(),
  createdAt: z.number().nullish(),
  country: z.string().nullish(),
  workplaceType: z.string().nullish(),
  description: z.string().nullish(),
  additional: z.string().nullish(),
  lists: z.array(z.object({ text: z.string().nullish(), content: z.string().nullish() })).nullish(),
  categories: z
    .object({ location: z.string().nullish(), allLocations: z.array(z.string()).nullish() })
    .nullish(),
});

export type LeverPosting = z.infer<typeof postingSchema>;

const WORKPLACE_TYPES: Record<string, NormalizedJob["remoteType"]> = {
  onsite: "onsite",
  hybrid: "hybrid",
  remote: "remote",
};

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

export function postingsUrl(sourceKey: string): string {
  const key = sourceKey.trim();
  const isEu = key.startsWith("eu:");
  const site = isEu ? key.slice(3) : key;
  const host = isEu ? "api.eu.lever.co" : "api.lever.co";
  return `https://${host}/v0/postings/${encodeURIComponent(site)}?mode=json`;
}

export function parseLeverPostings(data: unknown): unknown[] {
  if (!Array.isArray(data)) throw new Error("Lever response is not a list of postings; got a different document");
  return data;
}

function countryName(code: string | null | undefined): string | null {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null;
  try {
    return countryNames.of(code.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}

function formatLocation(posting: LeverPosting): string | null {
  const all = posting.categories?.allLocations ?? [];
  const places = (all.length > 0 ? all : [posting.categories?.location ?? ""]).map((p) => p.trim()).filter(Boolean);
  const country = countryName(posting.country);
  const withCountry = places.map((place) =>
    country && !place.toLowerCase().includes(country.toLowerCase()) ? `${place}, ${country}` : place,
  );
  const unique = [...new Set(withCountry)];
  if (unique.length > 0) return unique.join("; ");
  return country;
}

function descriptionHtml(posting: LeverPosting): string {
  const sections = (posting.lists ?? []).map(
    (list) => `<h3>${list.text ?? ""}</h3><ul>${list.content ?? ""}</ul>`,
  );
  return [posting.description ?? "", ...sections, posting.additional ?? ""].join("");
}

function parseTimestamp(ms: number | null | undefined): Date | null {
  if (ms === null || ms === undefined) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const leverAdapter: SourceAdapter<unknown> = {
  name: "LEVER",

  async fetchJobs(company, http) {
    return parseLeverPostings(await http.json(postingsUrl(company.sourceKey)));
  },

  normalize(raw, company) {
    const posting = postingSchema.parse(raw);
    return normalizedJobSchema.parse({
      externalId: posting.id,
      title: posting.text,
      company: company.name,
      location: formatLocation(posting),
      remoteType: WORKPLACE_TYPES[posting.workplaceType ?? ""] ?? null,
      description: htmlToText(descriptionHtml(posting)),
      url: posting.hostedUrl,
      postedAt: parseTimestamp(posting.createdAt),
    });
  },
};
