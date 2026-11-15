import type { PrismaClient, RunStatus } from "@jobradar/db";
import { log } from "../lib/logger";
import type { CompanyOutcome, FetchableCompany } from "./fetchCompanies";
import type { NotifyResult } from "./notify";
import { type RunTrigger, failRun, finishRun, startRun, summarizeOutcomes } from "./recordRun";

export type RunPipelineDeps = {
  prisma: PrismaClient;
  trigger: RunTrigger;
  gitSha: string | null;
  now: () => Date;
  fetchAll: (companies: FetchableCompany[]) => Promise<CompanyOutcome[]>;
  notify: () => Promise<NotifyResult>;
};

export async function runPipeline(deps: RunPipelineDeps): Promise<RunStatus> {
  const { prisma, now } = deps;
  const runId = await startRun(prisma, deps.trigger, deps.gitSha, now());
  log.info("run.start", { runId, trigger: deps.trigger });

  try {
    const companies = await prisma.company.findMany({ where: { active: true }, orderBy: { slug: "asc" } });
    const outcomes = await deps.fetchAll(companies);
    const status = await finishRun(prisma, runId, outcomes, now());
    const { emailsSent } = await deps.notify();
    await prisma.run.update({ where: { id: runId }, data: { emailsSent } });
    log.info("run.done", { runId, status, ...summarizeOutcomes(outcomes), emailsSent });
    return status;
  } catch (error) {
    await failRun(prisma, runId, error, now());
    log.error("run.failed", { runId, error });
    return "FAILED";
  }
}
