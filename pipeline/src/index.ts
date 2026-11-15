import { prisma } from "@jobradar/db";

async function main(): Promise<void> {
  const companies = await prisma.company.count();
  console.log(`companies in database: ${companies}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
