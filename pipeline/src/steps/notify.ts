import { createHash } from "node:crypto";
import type { PrismaClient } from "@jobradar/db";
import type { SendEmail } from "../email/send";
import { renderJobsEmail } from "../email/templates";
import { log } from "../lib/logger";

export type NotifyJob = {
  id: string;
  title: string;
  location: string | null;
  url: string;
  company: { name: string; slug: string };
};

export type NotifyResult = { jobs: number; emailsSent: number };

export type MarkNotified = (jobIds: string[], subject: string, providerMessageId: string) => Promise<void>;

export type NotifyDeps = { dryRun: boolean; send: SendEmail | null; markNotified: MarkNotified };

export function findJobsToNotify(prisma: PrismaClient): Promise<NotifyJob[]> {
  return prisma.job.findMany({
    where: { notificationId: null, isBaseline: false, filterStatus: "PASSED", closedAt: null },
    select: { id: true, title: true, location: true, url: true, company: { select: { name: true, slug: true } } },
    orderBy: [{ firstSeenAt: "asc" }, { title: "asc" }],
  });
}

export function idempotencyKeyFor(jobIds: readonly string[]): string {
  const hash = createHash("sha256").update([...jobIds].sort().join(",")).digest("hex");
  return `job-radar-summary-${hash}`;
}

export function createMarkNotified(prisma: PrismaClient, now: () => Date): MarkNotified {
  return async (jobIds, subject, providerMessageId) => {
    await prisma.$transaction(async (tx) => {
      const notification = await tx.notification.create({
        data: { kind: "RUN_SUMMARY", subject, providerMessageId, sentAt: now() },
      });
      await tx.job.updateMany({
        where: { id: { in: jobIds }, notificationId: null },
        data: { notificationId: notification.id },
      });
    });
  };
}

export async function notify(jobs: readonly NotifyJob[], deps: NotifyDeps): Promise<NotifyResult> {
  if (deps.dryRun) {
    log.info("notify.dry-run", { wouldEmail: jobs.length > 0, jobs: jobs.length });
    for (const job of jobs) {
      log.info("notify.would-send", { company: job.company.slug, title: job.title, location: job.location, url: job.url });
    }
    return { jobs: jobs.length, emailsSent: 0 };
  }

  if (jobs.length === 0) {
    log.info("notify.nothing-new");
    return { jobs: 0, emailsSent: 0 };
  }
  if (!deps.send) throw new Error("Email sending is not configured, but DRY_RUN is off");

  const jobIds = jobs.map((job) => job.id);
  const message = renderJobsEmail(jobs);
  const { id } = await deps.send(message, { idempotencyKey: idempotencyKeyFor(jobIds) });
  log.info("notify.sent", { jobs: jobs.length, subject: message.subject, providerMessageId: id });

  await deps.markNotified(jobIds, message.subject, id);
  return { jobs: jobs.length, emailsSent: 1 };
}
