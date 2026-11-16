import { z } from "zod";
import type { HttpClient } from "../lib/http";
import { htmlToText } from "../lib/html";
import { assertAllowedByRobots } from "../lib/robots";
import { type SourceAdapter, normalizedJobSchema } from "./types";

export const PAGE_SIZE = 50;
export const MAX_PAGES = 10;
export const PAUSE_MS = 1_500;

export type ListingSettings = { sectionId: string; langCode: string; sortBy: string; adPath: string };

export type EmplyJob = { vacancy: unknown; url: string };

const pageSchema = z.object({ vacancies: z.array(z.unknown()), count: z.number() });

const vacancySchema = z.object({
  id: z.string().min(1),
  title: z.string().nullish(),
  titleAsUrl: z.string(),
  shortId: z.string(),
  talentPool: z.boolean().nullish(),
  externalCseAdLink: z.string().nullish(),
  published: z.string().nullish(),
  created: z.string().nullish(),
  location: z.string().nullish(),
  translations: z
    .array(z.object({ title: z.string().nullish(), content: z.string().nullish(), languageKey: z.string().nullish() }))
    .nullish(),
});

type Vacancy = z.infer<typeof vacancySchema>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function listingUrl(sourceKey: string): URL {
  return new URL(sourceKey.trim());
}

export const pageEndpoint = (origin: string) => `${origin}/api/integration/vacancy/get-page`;

export function parseListingSettings(html: string, url: string): ListingSettings {
  const pick = (regex: RegExp) => regex.exec(html)?.[1];
  const sectionId = pick(/sectionId:\s*'([0-9a-f-]{36})'/);
  if (!sectionId) throw new Error(`No Emply job list on ${url}; the sourceKey must be the page that lists the jobs`);
  return {
    sectionId,
    langCode: pick(/languageKey\s*=\s*'([^']+)'/) ?? "da-DK",
    sortBy: pick(/sortByProjectDataId:\s*'([^']*)'/) ?? "",
    adPath: pick(/var adLink\s*=\s*'([^']+)'/) ?? "/ad/",
  };
}

export const pageBody = (settings: ListingSettings, offset: number) => ({
  count: PAGE_SIZE,
  filters: [],
  langCode: settings.langCode,
  offset,
  searchText: "",
  sectionId: settings.sectionId,
  sortByProjectDataId: settings.sortBy,
  sortAscending: false,
  light: false,
  isJobAgent: false,
  siteId: null,
});

function parsePage(data: unknown) {
  const result = pageSchema.safeParse(data);
  if (!result.success) throw new Error("Emply response has no vacancies list; got a different document");
  return result.data;
}

export function jobUrl(vacancy: Vacancy, origin: string, adPath: string): string {
  return vacancy.externalCseAdLink?.trim() || `${origin}${adPath}${vacancy.titleAsUrl}/${vacancy.shortId}`;
}

export async function fetchVacancies(sourceKey: string, http: HttpClient, pauseMs: number = PAUSE_MS): Promise<EmplyJob[]> {
  const url = listingUrl(sourceKey);
  await assertAllowedByRobots(http, url.href);
  const settings = parseListingSettings(await http.text(url.href), url.href);

  const jobs: EmplyJob[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    await sleep(pauseMs);
    const result = parsePage(await http.json(pageEndpoint(url.origin), { method: "POST", body: pageBody(settings, offset) }));
    for (const raw of result.vacancies) {
      const parsed = vacancySchema.safeParse(raw);
      if (parsed.success && parsed.data.talentPool) continue;
      jobs.push({ vacancy: raw, url: parsed.success ? jobUrl(parsed.data, url.origin, settings.adPath) : url.href });
    }
    offset += result.vacancies.length;
    if (result.vacancies.length === 0 || offset >= result.count) break;
  }
  return jobs;
}

function pickTranslation(vacancy: Vacancy) {
  const translations = vacancy.translations ?? [];
  return translations.find((t) => t.title?.trim()) ?? translations[0];
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const emplyAdapter: SourceAdapter<unknown> = {
  name: "EMPLY",

  async fetchJobs(company, http) {
    return fetchVacancies(company.sourceKey, http);
  },

  normalize(raw, company) {
    const { vacancy: rawVacancy, url } = z.object({ vacancy: z.unknown(), url: z.string() }).parse(raw);
    const vacancy = vacancySchema.parse(rawVacancy);
    const translation = pickTranslation(vacancy);
    return normalizedJobSchema.parse({
      externalId: vacancy.id,
      title: translation?.title?.trim() || vacancy.title,
      company: company.name,
      location: vacancy.location?.trim() || null,
      remoteType: null,
      description: htmlToText(translation?.content ?? ""),
      url,
      postedAt: parseDate(vacancy.published) ?? parseDate(vacancy.created),
    });
  },
};
