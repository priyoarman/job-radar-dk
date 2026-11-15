import type { Company, Prisma, PrismaClient } from "@jobradar/db";
import type { NormalizedJob } from "../sources/types";
import { type JobDiff, diffJobs } from "./diffJobs";

export type SaveCompany = Pick<Company, "id" | "slug" | "baselineDoneAt">;

export type SaveFetchStatus = "OK" | "EMPTY" | "SUSPICIOUS_EMPTY";

export type SaveResult = JobDiff & {
  fetchStatus: SaveFetchStatus;
  isBaseline: boolean;
  inserted: number;
  reopened: number;
  closed: number;
};

export function buildJobRows(
  jobs: readonly NormalizedJob[],
  companyId: string,
  isBaseline: boolean,
  now: Date,
): Prisma.JobCreateManyInput[] {
  return jobs.map(({ company: _company, ...job }) => ({
    ...job,
    companyId,
    isBaseline,
    scoreStatus: isBaseline ? "NOT_NEEDED" : "PENDING",
    firstSeenAt: now,
    lastSeenAt: now,
  }));
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
  const isBaseline = company.baselineDoneAt === null;
  const goneIds = fetchStatus === "SUSPICIOUS_EMPTY" ? [] : diff.goneIds;

  const seen = new Set(diff.seenIds);
  const reopened = existing.filter((job) => job.closedAt !== null && seen.has(job.externalId)).length;

  const [inserted, , closed] = await prisma.$transaction([
    prisma.job.createMany({
      data: buildJobRows(diff.newJobs, company.id, isBaseline, now),
      skipDuplicates: true,
    }),
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
    reopened,
    closed: closed.count,
  };
}
