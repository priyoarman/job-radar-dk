import type { Prisma, PrismaClient, RunStatus } from "@jobradar/db";
import { errorMessage } from "../lib/errors";
import type { CompanyOutcome } from "./fetchCompanies";

export type RunTrigger = "cron" | "manual" | "local";

export function runTriggerFor(githubEventName: string | undefined): RunTrigger {
  if (githubEventName === "schedule") return "cron";
  if (githubEventName === "workflow_dispatch") return "manual";
  return "local";
}

export function summarizeOutcomes(outcomes: readonly CompanyOutcome[]) {
  const sum = (pick: (o: CompanyOutcome) => number) => outcomes.reduce((n, o) => n + pick(o), 0);
  return {
    companiesChecked: outcomes.filter((o) => o.status !== "SKIPPED_RECENT").length,
    companiesSkipped: outcomes.filter((o) => o.status === "SKIPPED_RECENT").length,
    companiesFailed: outcomes.filter((o) => o.status === "ERROR").length,
    jobsFetched: sum((o) => o.jobsFound),
    jobsNew: sum((o) => o.jobsNew),
    jobsPassedFilter: sum((o) => o.jobsPassed),
  };
}

export function runStatusFor(outcomes: readonly CompanyOutcome[]): Extract<RunStatus, "SUCCESS" | "PARTIAL"> {
  return outcomes.some((o) => o.status === "ERROR") ? "PARTIAL" : "SUCCESS";
}

export function healthUpdateFor(outcome: CompanyOutcome): Prisma.CompanyUpdateInput | null {
  if (outcome.status === "SKIPPED_RECENT") return null;
  if (outcome.status === "ERROR") return { consecutiveFailures: { increment: 1 }, lastError: outcome.error };
  return { consecutiveFailures: 0, lastError: null };
}

export async function startRun(
  prisma: PrismaClient,
  trigger: RunTrigger,
  gitSha: string | null,
  now: Date,
): Promise<string> {
  const run = await prisma.run.create({ data: { trigger, gitSha, startedAt: now } });
  return run.id;
}

export async function finishRun(
  prisma: PrismaClient,
  runId: string,
  outcomes: readonly CompanyOutcome[],
  now: Date,
): Promise<RunStatus> {
  const status = runStatusFor(outcomes);
  const healthUpdates = outcomes.flatMap((o) => {
    const data = healthUpdateFor(o);
    return data ? [prisma.company.update({ where: { id: o.companyId }, data })] : [];
  });

  await prisma.$transaction([
    prisma.fetchLog.createMany({
      data: outcomes.map((o) => ({
        runId,
        companyId: o.companyId,
        status: o.status,
        httpStatus: o.httpStatus,
        jobsFound: o.jobsFound,
        jobsNew: o.jobsNew,
        durationMs: o.durationMs,
        error: o.error,
        createdAt: now,
      })),
    }),
    ...healthUpdates,
    prisma.run.update({
      where: { id: runId },
      data: { ...summarizeOutcomes(outcomes), status, finishedAt: now },
    }),
  ]);
  return status;
}

export async function failRun(prisma: PrismaClient, runId: string, error: unknown, now: Date): Promise<void> {
  await prisma.run.update({
    where: { id: runId },
    data: { status: "FAILED", error: errorMessage(error), finishedAt: now },
  });
}
