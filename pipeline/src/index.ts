import { createPrismaClient } from "@jobradar/db";
import { loadConfig } from "./config";

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = createPrismaClient(config.DATABASE_URL);
  try {
    const companies = await prisma.company.count();
    console.log(`companies in database: ${companies} (dry run: ${config.DRY_RUN})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
