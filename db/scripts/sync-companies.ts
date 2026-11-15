import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/index";
import { parseCompanies } from "../src/companies";

const DEFAULT_FILE = resolve(import.meta.dirname, "../../config/companies.json");

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${file}: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  const file = resolve(process.argv[2] ?? DEFAULT_FILE);
  const companies = parseCompanies(readJson(file));

  const existing = new Set(
    (await prisma.company.findMany({ select: { slug: true } })).map((c) => c.slug),
  );

  let created = 0;
  let updated = 0;
  for (const company of companies) {
    const data = {
      ...company,
      careersUrl: company.careersUrl ?? null,
      city: company.city ?? null,
      notes: company.notes ?? null,
    };
    await prisma.company.upsert({
      where: { slug: company.slug },
      create: data,
      update: data,
    });
    if (existing.has(company.slug)) updated++;
    else created++;
  }

  const inFile = new Set(companies.map((c) => c.slug));
  const onlyInDb = [...existing].filter((slug) => !inFile.has(slug));

  console.log(`Synced ${companies.length} companies from ${file}`);
  console.log(`  created: ${created}, updated: ${updated}`);
  if (onlyInDb.length > 0) {
    console.log(`  in database but not in file (left untouched): ${onlyInDb.join(", ")}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
