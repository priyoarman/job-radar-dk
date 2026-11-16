import * as cheerio from "cheerio";
import { errorMessage } from "../lib/errors";
import type { HttpClient } from "../lib/http";
import { isPathAllowed, robotsTxtFor } from "../lib/robots";
import { jobLinks } from "../sources/custom";
import { type Candidate, type Counts, countBoard } from "./candidates";

export type Supported = "TEAMTAILOR" | "GREENHOUSE" | "LEVER" | "LEVER_EU" | "ASHBY" | "WORKABLE" | "RECRUITEE" | "WORKDAY" | "SUCCESSFACTORS";
export type Unsupported = "EMPLY" | "HRMANAGER" | "SMARTRECRUITERS" | "PERSONIO" | "JOBYLON" | "REACHMEE" | "JSONLD";

export type Detection = { system: Supported | Unsupported; key: string; supported: boolean; evidence: string };

type Pattern = { system: Supported | Unsupported; regex: RegExp; key: (m: RegExpExecArray, page: URL) => string };

const SUPPORTED = new Set<string>(["TEAMTAILOR", "GREENHOUSE", "LEVER", "LEVER_EU", "ASHBY", "WORKABLE", "RECRUITEE", "WORKDAY", "SUCCESSFACTORS"]);

const IGNORED_SLUGS = new Set(["embed", "api", "www", "app", "jobs", "careers", "static", "assets", "cdn", "widget", "js"]);

const PATTERNS: Pattern[] = [
  { system: "TEAMTAILOR", regex: /https?:\/\/([a-z0-9-]+)\.teamtailor\.com/gi, key: (m) => `https://${m[1]!.toLowerCase()}.teamtailor.com` },
  { system: "TEAMTAILOR", regex: /(?:assets|cdn|scripts)\.teamtailor-cdn\.com|teamtailor-cdn\.com/gi, key: (_m, page) => page.origin },
  { system: "GREENHOUSE", regex: /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/gi, key: (m) => m[1]!.toLowerCase() },
  { system: "GREENHOUSE", regex: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([a-z0-9_-]+)/gi, key: (m) => m[1]!.toLowerCase() },
  { system: "LEVER_EU", regex: /jobs\.eu\.lever\.co\/([a-z0-9_-]+)/gi, key: (m) => `eu:${m[1]!.toLowerCase()}` },
  { system: "LEVER", regex: /jobs\.lever\.co\/([a-z0-9_-]+)/gi, key: (m) => m[1]!.toLowerCase() },
  { system: "ASHBY", regex: /jobs\.ashbyhq\.com\/([A-Za-z0-9._-]+)/g, key: (m) => m[1]! },
  { system: "ASHBY", regex: /api\.ashbyhq\.com\/posting-api\/job-board\/([A-Za-z0-9._-]+)/g, key: (m) => m[1]! },
  { system: "WORKABLE", regex: /apply\.workable\.com\/([a-z0-9_-]+)/gi, key: (m) => m[1]!.toLowerCase() },
  { system: "RECRUITEE", regex: /https?:\/\/([a-z0-9-]+)\.recruitee\.com/gi, key: (m) => m[1]!.toLowerCase() },
  {
    system: "WORKDAY",
    regex: /https?:\/\/([a-z0-9-]+\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/g,
    key: (m) => `https://${m[1]}/${m[2]}`,
  },
  { system: "SUCCESSFACTORS", regex: /rmkcdn\.successfactors\.com|jobs2web\.com/gi, key: (_m, page) => page.origin },
  { system: "EMPLY", regex: /https?:\/\/[a-z0-9.-]*emply\.(?:com|net|dk)[^"'\s<)]*/gi, key: (m) => m[0] },
  { system: "HRMANAGER", regex: /https?:\/\/[a-z0-9.-]*(?:hr-manager\.net|hr-skyen\.dk)[^"'\s<)]*/gi, key: (m) => m[0] },
  { system: "SMARTRECRUITERS", regex: /(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/g, key: (m) => m[1]! },
  { system: "PERSONIO", regex: /([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/gi, key: (m) => m[1]!.toLowerCase() },
  { system: "JOBYLON", regex: /https?:\/\/[a-z0-9.-]*jobylon\.com[^"'\s<)]*/gi, key: (m) => m[0] },
  { system: "REACHMEE", regex: /https?:\/\/[a-z0-9.-]*reachmee\.com[^"'\s<)]*/gi, key: (m) => m[0] },
  { system: "JSONLD", regex: /"@type"\s*:\s*"JobPosting"/g, key: (_m, page) => page.href },
];

export const MIN_CUSTOM_LINKS = 2;

export function detectBoards(html: string, pageUrl: string): Detection[] {
  const page = new URL(pageUrl);
  const found = new Map<string, Detection>();
  for (const pattern of PATTERNS) {
    for (const match of html.matchAll(pattern.regex)) {
      const key = pattern.key(match as RegExpExecArray, page);
      if (match[1] && IGNORED_SLUGS.has(match[1].toLowerCase())) continue;
      const id = `${pattern.system}|${key}`;
      if (!found.has(id)) {
        found.set(id, { system: pattern.system, key, supported: SUPPORTED.has(pattern.system), evidence: match[0].slice(0, 120) });
      }
    }
  }
  return [...found.values()];
}

const CAREERS_WORDS = /\b(careers?|jobs?|karriere|job|ledige[- ]stillinger|stillinger|work[- ]with[- ]us|join[- ]us|join[- ]the[- ]team|vacancies|arbejd[- ]hos[- ]os)\b/i;

export function careersLinks(html: string, pageUrl: string, max = 3): string[] {
  const $ = cheerio.load(html);
  const page = new URL(pageUrl);
  const scored: { url: string; score: number }[] = [];
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    if (/^(mailto|tel|javascript):|^#/.test(href)) return;
    let url: URL;
    try {
      url = new URL(href, page);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol)) return;
    const text = $(a).text().replace(/\s+/g, " ").trim();
    const inPath = CAREERS_WORDS.test(`${url.pathname} ${url.hostname.split(".")[0]}`);
    const inText = CAREERS_WORDS.test(text);
    if (!inPath && !inText) return;
    url.hash = "";
    scored.push({ url: url.href, score: (inPath ? 2 : 0) + (inText ? 1 : 0) + (url.hostname === page.hostname ? 0 : 1) });
  });
  const unique = new Map<string, number>();
  for (const { url, score } of scored) unique.set(url, Math.max(score, unique.get(url) ?? 0));
  return [...unique].sort((a, b) => b[1] - a[1]).map(([url]) => url).filter((url) => url !== page.href).slice(0, max);
}

export type DetectionResult = {
  id: number;
  name: string;
  website: string;
  status: "confirmed" | "confirmed-empty" | "found-unverified" | "found-custom" | "unsupported" | "blocked" | "nothing-found" | "error";
  system?: string;
  sourceKey?: string;
  counts?: Counts;
  pages: string[];
  other: Detection[];
  note?: string;
  requests: number;
};

async function verifyDetection(detection: Detection, name: string, http: HttpClient): Promise<Counts> {
  return countBoard({ source: detection.system as Supported, key: detection.key }, name, http);
}

export async function detectCompany(candidate: Candidate & { website?: string }, http: HttpClient): Promise<DetectionResult> {
  let requests = 0;
  const counted: HttpClient = {
    text: (url) => {
      requests++;
      return http.text(url);
    },
    json: (url, request) => {
      requests++;
      return http.json(url, request);
    },
  };
  const website = candidate.website!;
  const base = { id: candidate.id, name: candidate.name, website };
  const pages: string[] = [];
  const other: Detection[] = [];
  let empty: DetectionResult | null = null;
  let unverified: DetectionResult | null = null;
  let blocked = false;
  let lastError: string | undefined;

  const read = async (url: string): Promise<string | null> => {
    const { origin, pathname, search } = new URL(url);
    try {
      if (!isPathAllowed(await robotsTxtFor(counted, origin), `${pathname}${search}`)) {
        blocked = true;
        return null;
      }
    } catch (error) {
      lastError = errorMessage(error);
      return null;
    }
    try {
      const html = await counted.text(url);
      pages.push(url);
      return html;
    } catch (error) {
      lastError = errorMessage(error);
      return null;
    }
  };

  const tryDetections = async (detections: Detection[]): Promise<DetectionResult | null> => {
    for (const detection of detections) {
      if (!detection.supported) {
        if (!other.some((o) => o.system === detection.system && o.key === detection.key)) other.push(detection);
        continue;
      }
      if (detection.system === "WORKDAY") {
        unverified ??= { ...base, status: "found-unverified", system: "WORKDAY", sourceKey: detection.key, pages, other, note: "Workday rate-limits quickly; verified on the first pipeline run instead", requests };
        continue;
      }
      try {
        const counts = await verifyDetection(detection, candidate.name, counted);
        const system = detection.system === "LEVER_EU" ? "LEVER" : detection.system;
        const result: DetectionResult = { ...base, status: counts.jobs > 0 ? "confirmed" : "confirmed-empty", system, sourceKey: detection.key, counts, pages, other, requests };
        if (counts.jobs > 0) return result;
        empty ??= result;
      } catch (error) {
        const system = detection.system === "LEVER_EU" ? "LEVER" : detection.system;
        unverified ??= { ...base, status: "found-unverified", system, sourceKey: detection.key, pages, other, note: `check failed: ${errorMessage(error).slice(0, 100)}`, requests };
      }
    }
    return null;
  };

  let custom: { url: string; links: number } | null = null;
  const noteCustom = (html: string, url: string) => {
    const links = jobLinks(html, url).length;
    if (links >= MIN_CUSTOM_LINKS && links > (custom?.links ?? 0)) custom = { url, links };
  };

  const start = await read(website);
  if (start !== null) {
    const hit = await tryDetections(detectBoards(start, website));
    if (hit) return { ...hit, requests };
    noteCustom(start, website);
    for (const link of careersLinks(start, website)) {
      const html = await read(link);
      if (html === null) continue;
      noteCustom(html, link);
      const linked = await tryDetections([...detectBoards(link, link), ...detectBoards(html, link)]);
      if (linked) return { ...linked, requests };
    }
  }
  if (empty) return { ...(empty as DetectionResult), requests };
  if (unverified) return { ...(unverified as DetectionResult), requests };
  const page = custom as { url: string; links: number } | null;
  if (page) {
    return { ...base, status: "found-custom", system: "CUSTOM", sourceKey: page.url, pages, other, note: `${page.links} job links on the page; check it by hand`, requests };
  }
  if (other.length > 0) return { ...base, status: "unsupported", system: other[0]!.system, sourceKey: other[0]!.key, pages, other, requests };
  if (blocked) return { ...base, status: "blocked", pages, other, note: "robots.txt disallows the page", requests };
  if (start === null) return { ...base, status: "error", pages, other, note: lastError, requests };
  return { ...base, status: "nothing-found", pages, other, requests };
}
