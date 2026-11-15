import { z } from "zod";
import { htmlToText } from "../lib/html";
import { type NormalizedJob, type SourceAdapter, normalizedJobSchema } from "./types";

const responseSchema = z.object({ offers: z.array(z.unknown()) });

const offerSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  careers_url: z.string(),
  status: z.string().nullish(),
  location: z.string().nullish(),
  locations: z
    .array(z.object({ name: z.string().nullish(), city: z.string().nullish(), country: z.string().nullish() }))
    .nullish(),
  remote: z.boolean().nullish(),
  hybrid: z.boolean().nullish(),
  on_site: z.boolean().nullish(),
  published_at: z.string().nullish(),
  description: z.string().nullish(),
  requirements: z.string().nullish(),
});

export type RecruiteeOffer = z.infer<typeof offerSchema>;

export function offersUrl(sourceKey: string): string {
  return `https://${encodeURIComponent(sourceKey.trim())}.recruitee.com/api/offers/`;
}

export function parseRecruiteeOffers(data: unknown): unknown[] {
  const result = responseSchema.safeParse(data);
  if (!result.success) throw new Error("Recruitee response has no offers list; got a different document");
  return result.data.offers.filter((offer) => {
    const status = (offer as { status?: unknown }).status;
    return status === undefined || status === null || status === "published";
  });
}

function formatLocation(offer: RecruiteeOffer): string | null {
  const places = (offer.locations ?? [])
    .map((l) => [l.city?.trim() || l.name?.trim(), l.country?.trim()].filter(Boolean).join(", "))
    .filter(Boolean);
  const unique = [...new Set(places)];
  if (unique.length > 0) return unique.join("; ");
  return offer.location?.trim() || null;
}

function remoteType(offer: RecruiteeOffer): NormalizedJob["remoteType"] {
  if (offer.remote) return "remote";
  if (offer.hybrid) return "hybrid";
  if (offer.on_site) return "onsite";
  return null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/, "$1T$2Z"));
  return Number.isNaN(date.getTime()) ? null : date;
}

export const recruiteeAdapter: SourceAdapter<unknown> = {
  name: "RECRUITEE",

  async fetchJobs(company, http) {
    return parseRecruiteeOffers(await http.json(offersUrl(company.sourceKey)));
  },

  normalize(raw, company) {
    const offer = offerSchema.parse(raw);
    return normalizedJobSchema.parse({
      externalId: String(offer.id),
      title: offer.title,
      company: company.name,
      location: formatLocation(offer),
      remoteType: remoteType(offer),
      description: htmlToText(`${offer.description ?? ""}${offer.requirements ?? ""}`),
      url: offer.careers_url,
      postedAt: parseDate(offer.published_at),
    });
  },
};
