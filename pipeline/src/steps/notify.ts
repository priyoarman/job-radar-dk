import { createHash } from "node:crypto";
import type { FetchStatus, NotificationKind, PrismaClient } from "@jobradar/db";
import type { SendEmail } from "../email/send";
import { type SourceWarning, renderJobsEmail } from "../email/templates";
import { log } from "../lib/logger";

export type NotifyJob = {
  id: string;
  title: string;
  location: string | null;
  url: string;
  company: { name: string; slug: string };
};

export type NotifyInput = {
  jobs: NotifyJob[];
  warnings: SourceWarning[];
  lastHealthAlertAt: Date | null;
  now: Date;
};

export type EmailPlan =
  | { kind: "RUN_SUMMARY"; jobs: NotifyJob[]; warnings: SourceWarning[] }
  | { kind: "HEALTH_ALERT"; warnings: SourceWarning[] }
  | { kind: "NONE"; reason: "nothing-new" | "warning-sent-recently" };

export type NotifyResult = { jobs: number; emailsSent: number };

export type RecordNotification = (
  kind: NotificationKind,
  subject: string,
  providerMessageId: string,
  jobIds: string[],
) => Promise<void>;

export type NotifyDeps = { dryRun: boolean; send: SendEmail | null; record: RecordNotification };

export const FAILURES_BEFORE_WARNING = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

type CompanyHealth = {
  slug: string;
  name: string;
  consecutiveFailures: number;
  lastError: string | null;
  lastFetchStatus: FetchStatus | null;
};

export function warningsFrom(companies: readonly CompanyHealth[]): SourceWarning[] {
  return companies.flatMap((c): SourceWarning[] => {
    const base = { slug: c.slug, name: c.name, consecutiveFailures: c.consecutiveFailures, lastError: c.lastError };
    if (c.consecutiveFailures >= FAILURES_BEFORE_WARNING) return [{ ...base, reason: "failing" }];
    if (c.lastFetchStatus === "SUSPICIOUS_EMPTY") return [{ ...base, reason: "suspicious-empty" }];
    return [];
  });
}

export function planEmail(input: NotifyInput): EmailPlan {
  if (input.jobs.length > 0) return { kind: "RUN_SUMMARY", jobs: input.jobs, warnings: input.warnings };
  if (input.warnings.length === 0) return { kind: "NONE", reason: "nothing-new" };
  const sentRecently =
    input.lastHealthAlertAt !== null && input.now.getTime() - input.lastHealthAlertAt.getTime() < DAY_MS;
  return sentRecently ? { kind: "NONE", reason: "warning-sent-recently" } : { kind: "HEALTH_ALERT", warnings: input.warnings };
}

export function idempotencyKeyFor(plan: Exclude<EmailPlan, { kind: "NONE" }>, now: Date): string {
  const warnings = plan.warnings.map((w) => `${w.slug}:${w.reason}`).sort();
  const parts =
    plan.kind === "RUN_SUMMARY"
      ? ["summary", ...plan.jobs.map((j) => j.id).sort(), "|", ...warnings]
      : ["health", now.toISOString().slice(0, 10), ...warnings];
  const hash = createHash("sha256").update(parts.join(",")).digest("hex");
  return `job-radar-${plan.kind === "RUN_SUMMARY" ? "summary" : "health"}-${hash}`;
}

export async function findNotifyInput(prisma: PrismaClient, now: Date): Promise<NotifyInput> {
  const [jobs, companies, lastAlert] = await Promise.all([
    prisma.job.findMany({
      where: { notificationId: null, isBaseline: false, filterStatus: "PASSED", closedAt: null },
      select: { id: true, title: true, location: true, url: true, company: { select: { name: true, slug: true } } },
      orderBy: [{ firstSeenAt: "asc" }, { title: "asc" }],
    }),
    prisma.company.findMany({
      where: { active: true },
      orderBy: { slug: "asc" },
      select: {
        slug: true,
        name: true,
        consecutiveFailures: true,
        lastError: true,
        fetchLogs: {
          where: { status: { not: "SKIPPED_RECENT" } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true },
        },
      },
    }),
    prisma.notification.findFirst({ where: { kind: "HEALTH_ALERT" }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
  ]);
  const health = companies.map(({ fetchLogs, ...c }) => ({ ...c, lastFetchStatus: fetchLogs[0]?.status ?? null }));
  return { jobs, warnings: warningsFrom(health), lastHealthAlertAt: lastAlert?.sentAt ?? null, now };
}

export function createRecordNotification(prisma: PrismaClient, now: () => Date): RecordNotification {
  return async (kind, subject, providerMessageId, jobIds) => {
    await prisma.$transaction(async (tx) => {
      const notification = await tx.notification.create({
        data: { kind, subject, providerMessageId, sentAt: now() },
      });
      if (jobIds.length > 0) {
        await tx.job.updateMany({
          where: { id: { in: jobIds }, notificationId: null },
          data: { notificationId: notification.id },
        });
      }
    });
  };
}

export async function notify(input: NotifyInput, deps: NotifyDeps): Promise<NotifyResult> {
  const plan = planEmail(input);
  const jobCount = plan.kind === "RUN_SUMMARY" ? plan.jobs.length : 0;

  if (deps.dryRun) {
    log.info("notify.dry-run", { plan: plan.kind, jobs: jobCount, warnings: input.warnings.length });
    if (plan.kind === "RUN_SUMMARY") {
      for (const job of plan.jobs) {
        log.info("notify.would-send", { company: job.company.slug, title: job.title, location: job.location, url: job.url });
      }
    }
    for (const w of input.warnings) log.warn("notify.would-warn", { company: w.slug, reason: w.reason, lastError: w.lastError });
    return { jobs: jobCount, emailsSent: 0 };
  }

  if (plan.kind === "NONE") {
    log.info("notify.skipped", { reason: plan.reason, warnings: input.warnings.length });
    return { jobs: 0, emailsSent: 0 };
  }
  if (!deps.send) throw new Error("Email sending is not configured, but DRY_RUN is off");

  const message = renderJobsEmail(plan.kind === "RUN_SUMMARY" ? plan.jobs : [], plan.warnings);
  const { id } = await deps.send(message, { idempotencyKey: idempotencyKeyFor(plan, input.now) });
  log.info("notify.sent", { kind: plan.kind, jobs: jobCount, warnings: plan.warnings.length, subject: message.subject, providerMessageId: id });

  const jobIds = plan.kind === "RUN_SUMMARY" ? plan.jobs.map((j) => j.id) : [];
  await deps.record(plan.kind, message.subject, id, jobIds);
  return { jobs: jobCount, emailsSent: 1 };
}
