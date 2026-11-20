import type { Company, Prisma, PrismaClient } from "@jobradar/db";
import { log } from "../lib/logger";
import { type NormalizedJob, isSearchSource } from "../sources/types";
import { type JobDiff, diffJobs } from "./diffJobs";
import { filterJob, filterSearchJob } from "./filter";

export type SaveCompany = Pick<Company, "id" | "slug" | "source" | "baselineDoneAt">;

export type RowOptions = { searchSource: boolean };

export type SaveFetchStatus = "OK" | "EMPTY" | "SUSPICIOUS_EMPTY";

export type SaveResult = JobDiff & {
  fetchStatus: SaveFetchStatus;
  isBaseline: boolean;
  inserted: number;
  passed: number;
  reopened: number;
  closed: number;
};

export function buildJobRows(
  jobs: readonly NormalizedJob[],
  companyId: string,
  isBaseline: boolean,
  now: Date,
  options: RowOptions = { searchSource: false },
): Prisma.JobCreateManyInput[] {
  return jobs.map(({ company: employer, ...job }) => {
    const filter = options.searchSource ? filterSearchJob(job) : filterJob(job);
    return {
      ...job,
      employer: options.searchSource ? employer : null,
      companyId,
      isBaseline,
      filterStatus: filter.pass ? "PASSED" : "DROPPED",
      filterReason: filter.pass ? null : filter.reason,
      scoreStatus: isBaseline || !filter.pass ? "NOT_NEEDED" : "PENDING",
      firstSeenAt: now,
      lastSeenAt: now,
    };
  });
}

export function fetchStatusFor(openJobs: number, incomingJobs: number): SaveFetchStatus {
  if (incomingJobs > 0) return "OK";
  return openJobs > 0 ? "SUSPICIOUS_EMPTY" : "EMPTY";
}

export async function saveJobs(
  prisma: PrismaClient,
  company: SaveCompany,
  incoming: readonly NormalizedJob[],
  now: Date = new Date(),
): Promise<SaveResult> {
  const existing = await prisma.job.findMany({
    where: { companyId: company.id },
    select: { externalId: true, closedAt: true },
  });
  const diff = diffJobs(existing, incoming);
  const openJobs = existing.filter((job) => job.closedAt === null).length;
  const fetchStatus = fetchStatusFor(openJobs, incoming.length);
  const searchSource = isSearchSource(company.source);
  const isBaseline = !searchSource && company.baselineDoneAt === null;
  const goneIds = searchSource || fetchStatus === "SUSPICIOUS_EMPTY" ? [] : diff.goneIds;

  const seen = new Set(diff.seenIds);
  const reopened = existing.filter((job) => job.closedAt !== null && seen.has(job.externalId)).length;

  const rows = buildJobRows(diff.newJobs, company.id, isBaseline, now, { searchSource });
  for (const row of rows) {
    if (row.filterStatus === "DROPPED") {
      log.info("filter.dropped", { company: company.slug, title: row.title, reason: row.filterReason });
    }
  }

  const [inserted, , closed] = await prisma.$transaction([
    prisma.job.createMany({ data: rows, skipDuplicates: true }),
    prisma.job.updateMany({
      where: { companyId: company.id, externalId: { in: diff.seenIds } },
      data: { lastSeenAt: now, closedAt: null },
    }),
    prisma.job.updateMany({
      where: { companyId: company.id, externalId: { in: goneIds }, closedAt: null },
      data: { closedAt: now },
    }),
    prisma.company.updateMany({
      where: { id: company.id, baselineDoneAt: null },
      data: { baselineDoneAt: now },
    }),
  ]);

  return {
    ...diff,
    goneIds,
    fetchStatus,
    isBaseline,
    inserted: inserted.count,
    passed: rows.filter((row) => row.filterStatus === "PASSED").length,
    reopened,
    closed: closed.count,
  };
}
