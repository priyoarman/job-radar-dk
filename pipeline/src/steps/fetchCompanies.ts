import type { Company, FetchStatus, PrismaClient } from "@jobradar/db";
import { errorMessage } from "../lib/errors";
import { type HttpClient, HttpError } from "../lib/http";
import { log } from "../lib/logger";
import { normalizeJobs } from "../sources/normalize";
import { getAdapter } from "../sources/registry";
import { saveJobs } from "./saveJobs";

export type FetchableCompany = Pick<
  Company,
  "id" | "slug" | "name" | "source" | "sourceKey" | "baselineDoneAt" | "lastFetchedAt"
>;

export type ProcessResult = {
  status: Extract<FetchStatus, "OK" | "EMPTY" | "SUSPICIOUS_EMPTY">;
  jobsFound: number;
  jobsNew: number;
  jobsPassed: number;
  jobsClosed: number;
};

export type CompanyOutcome = {
  companyId: string;
  slug: string;
  status: FetchStatus;
  httpStatus: number | null;
  jobsFound: number;
  jobsNew: number;
  jobsPassed: number;
  jobsClosed: number;
  error: string | null;
  durationMs: number | null;
};

export type FetchCompaniesOptions = {
  minIntervalHours: number;
  pauseMs: number;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  processCompany: (company: FetchableCompany, now: Date) => Promise<ProcessResult>;
};

const HOUR_MS = 60 * 60 * 1000;

export function isFetchDue(lastFetchedAt: Date | null, now: Date, minIntervalHours: number): boolean {
  return lastFetchedAt === null || now.getTime() - lastFetchedAt.getTime() >= minIntervalHours * HOUR_MS;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function fetchCompanies(
  companies: readonly FetchableCompany[],
  options: FetchCompaniesOptions,
): Promise<CompanyOutcome[]> {
  const outcomes: CompanyOutcome[] = [];
  let fetchedBefore = false;

  for (const company of companies) {
    const base = { companyId: company.id, slug: company.slug, httpStatus: null, error: null };
    const startedAt = options.now();

    if (!isFetchDue(company.lastFetchedAt, startedAt, options.minIntervalHours)) {
      log.info("fetch.skipped", { company: company.slug, lastFetchedAt: company.lastFetchedAt });
      outcomes.push({ ...base, status: "SKIPPED_RECENT", jobsFound: 0, jobsNew: 0, jobsPassed: 0, jobsClosed: 0, durationMs: null });
      continue;
    }

    if (fetchedBefore) await options.sleep(options.pauseMs);
    fetchedBefore = true;

    try {
      const result = await options.processCompany(company, startedAt);
      const durationMs = options.now().getTime() - startedAt.getTime();
      const level = result.status === "SUSPICIOUS_EMPTY" ? "warn" : "info";
      log[level]("fetch.done", { company: company.slug, ...result, durationMs });
      outcomes.push({ ...base, ...result, durationMs });
    } catch (error) {
      const durationMs = options.now().getTime() - startedAt.getTime();
      const httpStatus = error instanceof HttpError ? error.status : null;
      const message = errorMessage(error);
      log.error("fetch.error", { company: company.slug, httpStatus, error: message, durationMs });
      outcomes.push({
        ...base,
        status: "ERROR",
        httpStatus,
        jobsFound: 0,
        jobsNew: 0,
        jobsPassed: 0,
        jobsClosed: 0,
        error: message,
        durationMs,
      });
    }
  }

  return outcomes;
}

export function createProcessCompany(prisma: PrismaClient, http: HttpClient) {
  return async (company: FetchableCompany, now: Date): Promise<ProcessResult> => {
    try {
      const adapter = getAdapter(company.source);
      const raws = await adapter.fetchJobs(company, http);
      const { jobs } = normalizeJobs(adapter, raws, company);
      const saved = await saveJobs(prisma, company, jobs, now);
      await prisma.company.update({
        where: { id: company.id },
        data: { lastSuccessAt: now, lastJobCount: jobs.length },
      });
      return {
        status: saved.fetchStatus,
        jobsFound: raws.length,
        jobsNew: saved.inserted,
        jobsPassed: saved.passed,
        jobsClosed: saved.closed,
      };
    } finally {
      await prisma.company.update({ where: { id: company.id }, data: { lastFetchedAt: now } });
    }
  };
}
