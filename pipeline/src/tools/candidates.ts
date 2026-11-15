import { z } from "zod";
import { errorMessage } from "../lib/errors";
import type { HttpClient } from "../lib/http";
import { normalizeJobs } from "../sources/normalize";
import { getAdapter } from "../sources/registry";
import { filterJob } from "../steps/filter";
import { isAbroadOnly } from "../steps/location";

export const candidateSchema = z.object({
  id: z.number(),
  name: z.string(),
  category: z.string(),
  claimed: z.array(z.string()).min(1),
  claimedUrl: z.string().nullable(),
  watchedSlug: z.string().optional(),
});

export type Candidate = z.infer<typeof candidateSchema>;

export const PROBE_SOURCES = ["TEAMTAILOR", "GREENHOUSE", "LEVER", "LEVER_EU", "ASHBY", "WORKABLE", "RECRUITEE"] as const;

export type ProbeSource = (typeof PROBE_SOURCES)[number];
export type Probe = { source: ProbeSource; key: string; fromClaim: boolean };

export type Counts = { jobs: number; inDenmark: number; matches: number };

export type Status =
  | "already-watched"
  | "confirmed"
  | "confirmed-empty"
  | "exists-unsupported"
  | "unverified-unsupported"
  | "manual"
  | "not-found";

const UNVERIFIABLE = ["EMPLY", "HRMANAGER", "ORACLE", "ICIMS", "TALENTIUM", "JOBINDEX"];

export type CandidateResult = {
  id: number;
  name: string;
  category: string;
  claimed: string[];
  status: Status;
  source?: string;
  sourceKey?: string;
  claimCorrect?: boolean;
  counts?: Counts;
  note?: string;
  requests: number;
};

const FOLD: Record<string, string> = { æ: "ae", ø: "o", å: "aa", é: "e", ü: "u", ö: "o", ä: "a" };

export function slugFor(name: string): string {
  return name
    .split(" / ")[0]!
    .replace(/\(.*?\)/g, " ")
    .toLowerCase()
    .replace(/[æøåéüöä]/g, (c) => FOLD[c] ?? c)
    .replace(/\b(denmark|a\/s|aps)\b/g, " ")
    .replace(/\.(com|io|ai|dk|us)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function probeFromClaim(url: string | null): Probe | null {
  if (!url) return null;
  const clean = url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const rules: Array<[RegExp, ProbeSource, (m: RegExpExecArray) => string]> = [
    [/^([a-z0-9-]+)\.teamtailor\.com$/i, "TEAMTAILOR", (m) => `https://${m[1]}.teamtailor.com`],
    [/^boards\.greenhouse\.io\/([^/?#]+)/i, "GREENHOUSE", (m) => m[1]!],
    [/^jobs\.lever\.co\/([^/?#]+)/i, "LEVER", (m) => m[1]!],
    [/^jobs\.ashbyhq\.com\/([^/?#]+)/i, "ASHBY", (m) => m[1]!],
    [/^apply\.workable\.com\/([^/?#]+)/i, "WORKABLE", (m) => m[1]!],
    [/^([a-z0-9-]+)\.recruitee\.com$/i, "RECRUITEE", (m) => m[1]!],
  ];
  for (const [regex, source, key] of rules) {
    const match = regex.exec(clean);
    if (match) return { source, key: key(match), fromClaim: true };
  }
  return null;
}

export function sourceKeyFor(source: ProbeSource, slug: string): string {
  if (source === "TEAMTAILOR") return `https://${slug}.teamtailor.com`;
  if (source === "LEVER_EU") return `eu:${slug}`;
  return slug;
}

export function probesFor(candidate: Candidate): Probe[] {
  const claim = probeFromClaim(candidate.claimedUrl);
  const slug = slugFor(candidate.name);
  const fallback = PROBE_SOURCES.map((source) => ({ source, key: sourceKeyFor(source, slug), fromClaim: false }));
  const all = claim ? [claim, ...fallback] : fallback;
  const seen = new Set<string>();
  return all.filter((p) => {
    const id = `${p.source}|${p.key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return slug.length > 0 || p.fromClaim;
  });
}

const adapterName = (source: ProbeSource) => (source === "LEVER_EU" ? "LEVER" : source);

export async function countBoard(probe: Probe, name: string, http: HttpClient): Promise<Counts> {
  const adapter = getAdapter(adapterName(probe.source));
  const company = { slug: slugFor(name) || "candidate", name, sourceKey: probe.key };
  const raws = await adapter.fetchJobs(company, http);
  const { jobs } = normalizeJobs(adapter, raws, company);
  return {
    jobs: jobs.length,
    inDenmark: jobs.filter((j) => !isAbroadOnly(j.location)).length,
    matches: jobs.filter((j) => filterJob(j).pass).length,
  };
}

async function smartRecruitersCounts(http: HttpClient, id: string): Promise<Counts | null> {
  try {
    const data = (await http.json(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(id)}/postings?limit=100`)) as {
      totalFound?: number;
      content?: { location?: { country?: string } }[];
    };
    if (typeof data.totalFound !== "number" || data.totalFound === 0) return null;
    const inDenmark = (data.content ?? []).filter((p) => p.location?.country?.toLowerCase() === "dk").length;
    return { jobs: data.totalFound, inDenmark, matches: 0 };
  } catch {
    return null;
  }
}

export async function verifyCandidate(candidate: Candidate, http: HttpClient): Promise<CandidateResult> {
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
  const base = { id: candidate.id, name: candidate.name, category: candidate.category, claimed: candidate.claimed };
  const first = candidate.claimed[0]!;

  if (candidate.watchedSlug) return { ...base, status: "already-watched", sourceKey: candidate.watchedSlug, requests: 0 };

  let empty: CandidateResult | null = null;
  let claimError: string | undefined;
  for (const probe of probesFor(candidate)) {
    try {
      const counts = await countBoard(probe, candidate.name, counted);
      const result: CandidateResult = {
        ...base,
        status: counts.jobs > 0 ? "confirmed" : "confirmed-empty",
        source: adapterName(probe.source),
        sourceKey: probe.key,
        claimCorrect: candidate.claimed.includes(adapterName(probe.source)) && (probe.fromClaim || !probeFromClaim(candidate.claimedUrl)),
        counts,
        requests,
      };
      if (counts.jobs > 0) return { ...result, requests };
      empty ??= result;
    } catch (error) {
      if (probe.fromClaim) claimError = errorMessage(error);
    }
  }
  if (empty?.claimCorrect) return { ...empty, requests };

  const claimNote = claimError ? `claimed board failed: ${claimError}` : undefined;
  if (first === "SMARTRECRUITERS" && candidate.claimedUrl) {
    const id = candidate.claimedUrl.split("/").pop() ?? "";
    const counts = await smartRecruitersCounts(counted, id);
    if (counts) return { ...base, status: "exists-unsupported", source: "SMARTRECRUITERS", sourceKey: id, counts, requests };
  }
  const unverifiable = candidate.claimed.find((system) => UNVERIFIABLE.includes(system));
  if (unverifiable) {
    return {
      ...base,
      status: "unverified-unsupported",
      source: unverifiable,
      note: `claims ${candidate.claimed.join(" / ")}; not on any supported portal under its name${empty ? ` (an empty ${empty.source} board exists)` : ""}`,
      requests,
    };
  }
  if (empty) return { ...empty, requests };
  if (first === "WORKDAY" || first === "SUCCESSFACTORS") {
    return { ...base, status: "manual", note: `${first} needs a site name or careers URL; check by hand`, requests };
  }
  return { ...base, status: "not-found", note: claimNote ?? `no board on supported portals (claimed: ${candidate.claimed.join(", ")})`, requests };
}

export function summarize(results: readonly CandidateResult[]) {
  const byStatus: Record<string, number> = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const bySource: Record<string, number> = {};
  for (const r of results) if (r.source && r.status !== "already-watched") bySource[`${r.status}:${r.source}`] = (bySource[`${r.status}:${r.source}`] ?? 0) + 1;
  const checkedClaims = results.filter((r) => r.claimCorrect !== undefined);
  return {
    byStatus,
    bySource,
    claimsChecked: checkedClaims.length,
    claimsCorrect: checkedClaims.filter((r) => r.claimCorrect).length,
    requests: results.reduce((n, r) => n + r.requests, 0),
  };
}
