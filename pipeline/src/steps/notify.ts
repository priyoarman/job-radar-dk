import type { PrismaClient } from "@jobradar/db";
import { log } from "../lib/logger";

export type NotifyJob = {
  id: string;
  title: string;
  location: string | null;
  url: string;
  company: { name: string; slug: string };
};

export type NotifyResult = { jobs: number; emailsSent: number };

export function findJobsToNotify(prisma: PrismaClient): Promise<NotifyJob[]> {
  return prisma.job.findMany({
    where: { notificationId: null, isBaseline: false, filterStatus: "PASSED", closedAt: null },
    select: { id: true, title: true, location: true, url: true, company: { select: { name: true, slug: true } } },
    orderBy: [{ firstSeenAt: "asc" }, { title: "asc" }],
  });
}

export async function notify(jobs: readonly NotifyJob[], options: { dryRun: boolean }): Promise<NotifyResult> {
  if (options.dryRun) {
    log.info("notify.dry-run", { wouldEmail: jobs.length > 0, jobs: jobs.length });
    for (const job of jobs) {
      log.info("notify.would-send", {
        company: job.company.slug,
        title: job.title,
        location: job.location,
        url: job.url,
      });
    }
    return { jobs: jobs.length, emailsSent: 0 };
  }

  log.warn("notify.not-ready", { jobs: jobs.length, reason: "email sending is added in steps 1.24 and 1.25" });
  return { jobs: jobs.length, emailsSent: 0 };
}
