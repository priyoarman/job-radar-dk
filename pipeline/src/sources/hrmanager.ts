import { z } from "zod";
import { type HttpClient, HttpError } from "../lib/http";
import { htmlToText } from "../lib/html";
import { type SourceAdapter, normalizedJobSchema } from "./types";

export const PAGE_SIZE = 100;
export const MAX_PAGES = 3;
export const PAUSE_MS = 1_500;

const listSchema = z.object({
  TransactionStatus: z.object({ StatusCode: z.number(), Description: z.string().nullish() }),
  Items: z.array(z.unknown()),
  PositionCountList: z.number().nullish(),
});

const named = z.object({ Name: z.string().nullish() }).nullish();

const positionSchema = z.object({
  Id: z.union([z.number(), z.string()]),
  Name: z.string(),
  AdvertisementUrlSecure: z.string().nullish(),
  AdvertisementUrl: z.string().nullish(),
  Published: z.string().nullish(),
  Created: z.string().nullish(),
  WorkPlace: z.string().nullish(),
  PositionLocation: named,
  PositionLocationMultiSelection: z.array(named).nullish(),
  Department: z.object({ City: z.string().nullish() }).nullish(),
  Advertisements: z
    .array(z.object({ Introduction: z.string().nullish(), Content: z.string().nullish() }))
    .nullish(),
});

type Position = z.infer<typeof positionSchema>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function customerAlias(sourceKey: string): string {
  const alias = sourceKey.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(alias)) throw new Error(`HR Manager sourceKey must be a customer alias like "bec", got ${sourceKey}`);
  return alias;
}

export function positionListUrl(alias: string, skip: number): string {
  const params = new URLSearchParams({ incads: "1", take: String(PAGE_SIZE) });
  if (skip > 0) params.set("skip", String(skip));
  return `https://recruiter-api.hr-manager.net/jobportal.svc/${encodeURIComponent(alias)}/positionlist/json/?${params.toString()}`;
}

export function parsePositionList(data: unknown) {
  const result = listSchema.safeParse(data);
  if (!result.success) throw new Error("HR Manager response has no Items list; got a different document");
  const { TransactionStatus: status } = result.data;
  if (status.StatusCode !== 0) throw new Error(`HR Manager answered with error ${status.StatusCode}: ${status.Description?.trim() ?? "no description"}`);
  return result.data;
}

export async function fetchPositions(sourceKey: string, http: HttpClient, pauseMs: number = PAUSE_MS): Promise<unknown[]> {
  const alias = customerAlias(sourceKey);
  const positions: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(pauseMs);
    const url = positionListUrl(alias, positions.length);
    let data: unknown;
    try {
      data = await http.json(url);
    } catch (error) {
      if (error instanceof HttpError && error.status === 400) throw new Error(`HR Manager does not know the customer alias "${alias}" (HTTP 400)`);
      throw error;
    }
    const list = parsePositionList(data);
    positions.push(...list.Items);
    if (list.Items.length < PAGE_SIZE || positions.length >= (list.PositionCountList ?? 0)) break;
  }
  return positions;
}

export function parseDotNetDate(value: string | null | undefined): Date | null {
  const ms = value ? /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value.trim())?.[1] : undefined;
  if (ms === undefined || Number(ms) <= 0) return null;
  return new Date(Number(ms));
}

function formatLocation(position: Position): string | null {
  const places = (position.PositionLocationMultiSelection ?? []).map((l) => l?.Name?.trim()).filter(Boolean);
  const unique = [...new Set(places)];
  if (unique.length > 0) return unique.join("; ");
  return position.PositionLocation?.Name?.trim() || position.WorkPlace?.trim() || position.Department?.City?.trim() || null;
}

export const hrManagerAdapter: SourceAdapter<unknown> = {
  name: "HRMANAGER",

  async fetchJobs(company, http) {
    return fetchPositions(company.sourceKey, http);
  },

  normalize(raw, company) {
    const position = positionSchema.parse(raw);
    const ad = position.Advertisements?.[0];
    return normalizedJobSchema.parse({
      externalId: String(position.Id),
      title: position.Name,
      company: company.name,
      location: formatLocation(position),
      remoteType: null,
      description: htmlToText(`${ad?.Introduction ?? ""}${ad?.Content ?? ""}`),
      url: position.AdvertisementUrlSecure || position.AdvertisementUrl,
      postedAt: parseDotNetDate(position.Published) ?? parseDotNetDate(position.Created),
    });
  },
};
