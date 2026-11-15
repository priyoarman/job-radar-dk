import type { Company, Prisma, PrismaClient } from "@jobradar/db";
import type { NormalizedJob } from "../sources/types";
import { type JobDiff, diffJobs } from "./diffJobs";

export type SaveCompany = Pick<Company, "id" | "slug" | "baselineDoneAt">;

export type SaveResult = JobDiff & { inserted: number; isBaseline: boolean };

export function buildJobRows(
  jobs: readonly NormalizedJob[],
  companyId: string,
  isBaseline: boolean,
): Prisma.JobCreateManyInput[] {
  return jobs.map(({ company: _company, ...job }) => ({
    ...job,
    companyId,
    isBaseline,
    scoreStatus: isBaseline ? "NOT_NEEDED" : "PENDING",
  }));
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
  const isBaseline = company.baselineDoneAt === null;

  const insert = prisma.job.createMany({
    data: buildJobRows(diff.newJobs, company.id, isBaseline),
    skipDuplicates: true,
  });

  if (!isBaseline) {
    const { count } = await insert;
    return { ...diff, inserted: count, isBaseline };
  }

  const [{ count }] = await prisma.$transaction([
    insert,
    prisma.company.update({ where: { id: company.id }, data: { baselineDoneAt: now } }),
  ]);
  return { ...diff, inserted: count, isBaseline };
}
