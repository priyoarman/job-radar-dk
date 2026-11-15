import { XMLParser, XMLValidator } from "fast-xml-parser";
import { htmlToText } from "../lib/html";
import { type NormalizedJob, type SourceAdapter, normalizedJobSchema } from "./types";

export type TeamtailorRawLocation = {
  name?: string;
  address?: string;
  zip?: string;
  city?: string;
  country?: string;
};

export type TeamtailorRawItem = {
  title?: string;
  description?: string;
  pubDate?: string;
  link?: string;
  guid?: string;
  remoteStatus?: string;
  company_name?: string;
  locations?: { location?: TeamtailorRawLocation[] } | "";
  department?: string;
  role?: string;
};

const ALWAYS_ARRAY = new Set(["item", "location"]);

const parser = new XMLParser({
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (tagName) => ALWAYS_ARRAY.has(tagName),
});

export function parseTeamtailorFeed(xml: string): TeamtailorRawItem[] {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    const { msg, line } = validation.err;
    throw new Error(`Teamtailor feed is not valid XML (line ${line}): ${msg}`);
  }

  const doc = parser.parse(xml) as { rss?: { channel?: { item?: TeamtailorRawItem[] } | "" } };
  const channel = doc.rss?.channel;
  if (channel === undefined) {
    throw new Error("Teamtailor feed has no <rss><channel>; got a different document");
  }
  return channel === "" ? [] : (channel.item ?? []);
}

const REMOTE_STATUS: Record<string, NormalizedJob["remoteType"]> = {
  fully: "remote",
  hybrid: "hybrid",
  onsite: "onsite",
};

function formatLocations(item: TeamtailorRawItem): string | null {
  const locations = item.locations === "" ? [] : (item.locations?.location ?? []);
  const parts = locations
    .map((l) => [l.city || l.name, l.country].filter(Boolean).join(", "))
    .filter(Boolean);
  const unique = [...new Set(parts)];
  return unique.length > 0 ? unique.join("; ") : null;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const teamtailorAdapter: SourceAdapter<TeamtailorRawItem> = {
  name: "TEAMTAILOR",

  async fetchJobs(company, http) {
    const url = `${company.sourceKey.replace(/\/+$/, "")}/jobs.rss`;
    return parseTeamtailorFeed(await http.text(url));
  },

  normalize(raw, company) {
    return normalizedJobSchema.parse({
      externalId: raw.guid || raw.link,
      title: raw.title,
      company: company.name,
      location: formatLocations(raw),
      remoteType: REMOTE_STATUS[raw.remoteStatus ?? ""] ?? null,
      description: htmlToText(raw.description ?? ""),
      url: raw.link,
      postedAt: parseDate(raw.pubDate),
    });
  },
};
