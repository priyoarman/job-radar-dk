import { createPrismaClient } from "@jobradar/db";
import { loadConfig } from "./config";
import { log } from "./lib/logger";

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = createPrismaClient(config.DATABASE_URL);
  try {
    log.info("run.start", { dryRun: config.DRY_RUN });
    const companies = await prisma.company.count();
    log.info("db.companies", { count: companies });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  log.error("run.failed", { error });
  process.exitCode = 1;
});
