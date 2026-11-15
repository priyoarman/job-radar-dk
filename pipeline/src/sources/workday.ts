import { z } from "zod";
import type { HttpClient } from "../lib/http";
import { classifyPlace } from "../steps/location";
import { type NormalizedJob, type SourceAdapter, normalizedJobSchema } from "./types";

export const PAGE_SIZE = 20;
export const MAX_PAGES = 10;
export const PAUSE_MS = 1_500;

export type WorkdaySite = { host: string; tenant: string; site: string };

type Facet = { facetParameter?: string | null; descriptor?: string | null; id?: string | null; values?: Facet[] | null };

const listSchema = z.object({
  total: z.number().nullish(),
  jobPostings: z.array(z.unknown()),
  facets: z.array(z.unknown()).nullish(),
});

const postingSchema = z.object({
  title: z.string(),
  externalPath: z.string(),
  locationsText: z.string().nullish(),
  remoteType: z.string().nullish(),
  bulletFields: z.array(z.string()).nullish(),
});

const REMOTE_TYPES: Record<string, NormalizedJob["remoteType"]> = {
  flex: "hybrid",
  hybrid: "hybrid",
  remote: "remote",
  onsite: "onsite",
  "on site": "onsite",
  "site based": "onsite",
};

export function parseSiteUrl(sourceKey: string): WorkdaySite {
  const url = new URL(sourceKey.trim());
  if (!url.hostname.endsWith(".myworkdayjobs.com")) {
    throw new Error(`Workday sourceKey must be a myworkdayjobs.com careers URL, got ${sourceKey}`);
  }
  const segments = url.pathname.split("/").filter((s) => s && !/^[a-z]{2}-[A-Z]{2}$/.test(s));
  const site = segments[0];
  if (!site) throw new Error(`Workday sourceKey has no site name in its path: ${sourceKey}`);
  return { host: url.hostname, tenant: url.hostname.split(".")[0] ?? "", site };
}

export const jobsEndpoint = ({ host, tenant, site }: WorkdaySite) => `https://${host}/wday/cxs/${tenant}/${site}/jobs`;

export function denmarkFacet(facets: unknown[]): { parameter: string; ids: string[] } | null {
  const matches = new Map<string, string[]>();
  const walk = (list: Facet[] | null | undefined, parameter: string | null) => {
    for (const facet of list ?? []) {
      const param = facet.facetParameter ?? parameter;
      if (facet.id && param && facet.descriptor && classifyPlace(facet.descriptor) === "denmark") {
        matches.set(param, [...(matches.get(param) ?? []), facet.id]);
      }
      walk(facet.values, param);
    }
  };
  walk(facets as Facet[], null);
  if (matches.size === 0) return null;
  const params = [...matches.keys()];
  const parameter = params.find((p) => /country/i.test(p)) ?? params.sort((a, b) => matches.get(b)!.length - matches.get(a)!.length)[0]!;
  return { parameter, ids: matches.get(parameter)! };
}

function parseList(data: unknown) {
  const result = listSchema.safeParse(data);
  if (!result.success) throw new Error("Workday response has no jobPostings list; got a different document");
  return result.data;
}

const searchBody = (appliedFacets: Record<string, string[]>, offset: number, limit: number) => ({
  appliedFacets,
  limit,
  offset,
  searchText: "",
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchDenmarkPostings(
  site: WorkdaySite,
  http: HttpClient,
  pauseMs: number = PAUSE_MS,
): Promise<unknown[]> {
  const endpoint = jobsEndpoint(site);
  const first = parseList(await http.json(endpoint, { method: "POST", body: searchBody({}, 0, 1) }));
  const denmark = denmarkFacet(first.facets ?? []);
  if (!denmark) return [];

  const applied = { [denmark.parameter]: denmark.ids };
  const postings: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    await sleep(pauseMs);
    const offset = page * PAGE_SIZE;
    const list = parseList(await http.json(endpoint, { method: "POST", body: searchBody(applied, offset, PAGE_SIZE) }));
    postings.push(...list.jobPostings);
    if (list.jobPostings.length < PAGE_SIZE || offset + PAGE_SIZE >= (list.total ?? 0)) break;
  }
  return postings;
}

function formatLocation(text: string | null | undefined): string {
  const value = text?.trim();
  if (!value) return "Denmark";
  const many = /^(\d+) Locations?$/i.exec(value);
  if (many) return `Denmark (${many[1]} locations)`;
  return classifyPlace(value) === "denmark" ? value : `${value}, Denmark`;
}

export const workdayAdapter: SourceAdapter<unknown> = {
  name: "WORKDAY",

  async fetchJobs(company, http) {
    return fetchDenmarkPostings(parseSiteUrl(company.sourceKey), http);
  },

  normalize(raw, company) {
    const posting = postingSchema.parse(raw);
    const { host, site } = parseSiteUrl(company.sourceKey);
    return normalizedJobSchema.parse({
      externalId: posting.bulletFields?.[0]?.trim() || posting.externalPath,
      title: posting.title,
      company: company.name,
      location: formatLocation(posting.locationsText),
      remoteType: REMOTE_TYPES[posting.remoteType?.trim().toLowerCase() ?? ""] ?? null,
      description: "",
      url: `https://${host}/${site}${posting.externalPath}`,
      postedAt: null,
    });
  },
};
