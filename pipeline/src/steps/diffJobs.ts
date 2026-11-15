import type { NormalizedJob } from "../sources/types";

export type ExistingJob = { externalId: string; closedAt: Date | null };

export type JobDiff = {
  newJobs: NormalizedJob[];
  seenIds: string[];
  goneIds: string[];
};

export function diffJobs(existing: readonly ExistingJob[], incoming: readonly NormalizedJob[]): JobDiff {
  const knownIds = new Set(existing.map((job) => job.externalId));
  const incomingIds = new Set<string>();
  const newJobs: NormalizedJob[] = [];
  const seenIds: string[] = [];

  for (const job of incoming) {
    if (incomingIds.has(job.externalId)) continue;
    incomingIds.add(job.externalId);
    if (knownIds.has(job.externalId)) seenIds.push(job.externalId);
    else newJobs.push(job);
  }

  const goneIds = existing
    .filter((job) => job.closedAt === null && !incomingIds.has(job.externalId))
    .map((job) => job.externalId);

  return { newJobs, seenIds, goneIds };
}
