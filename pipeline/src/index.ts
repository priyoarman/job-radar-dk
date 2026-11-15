import { createPrismaClient } from "@jobradar/db";
import { loadConfig } from "./config";
import { fetchText } from "./lib/http";
import { log } from "./lib/logger";
import { createProcessCompany, fetchCompanies, sleep } from "./steps/fetchCompanies";

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = createPrismaClient(config.DATABASE_URL);
  try {
    log.info("run.start", { dryRun: config.DRY_RUN });
    const companies = await prisma.company.findMany({ where: { active: true }, orderBy: { slug: "asc" } });

    const outcomes = await fetchCompanies(companies, {
      minIntervalHours: config.MIN_FETCH_INTERVAL_HOURS,
      pauseMs: 1_000,
      now: () => new Date(),
      sleep,
      processCompany: createProcessCompany(prisma, (url) => fetchText(url, { userAgent: config.USER_AGENT })),
    });

    const byStatus: Record<string, number> = {};
    for (const o of outcomes) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    log.info("run.done", {
      companies: outcomes.length,
      ...byStatus,
      jobsFound: outcomes.reduce((n, o) => n + o.jobsFound, 0),
      jobsNew: outcomes.reduce((n, o) => n + o.jobsNew, 0),
      jobsClosed: outcomes.reduce((n, o) => n + o.jobsClosed, 0),
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  log.error("run.failed", { error });
  process.exitCode = 1;
});
