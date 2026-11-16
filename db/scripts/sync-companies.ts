import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPrismaClient } from "../src/index";
import { boardChanged, parseCompanies } from "../src/companies";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to .env.");
  process.exit(1);
}
const prisma = createPrismaClient(databaseUrl);

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

  const existing = new Map(
    (await prisma.company.findMany({ select: { slug: true, source: true, sourceKey: true } })).map((c) => [c.slug, c]),
  );

  let created = 0;
  let updated = 0;
  const rebaselined: string[] = [];
  for (const company of companies) {
    const data = {
      ...company,
      careersUrl: company.careersUrl ?? null,
      city: company.city ?? null,
      notes: company.notes ?? null,
    };
    const newBoard = boardChanged(existing.get(company.slug), company);
    if (newBoard) rebaselined.push(company.slug);
    await prisma.company.upsert({
      where: { slug: company.slug },
      create: data,
      update: newBoard ? { ...data, baselineDoneAt: null, lastJobCount: null } : data,
    });
    if (existing.has(company.slug)) updated++;
    else created++;
  }

  const inFile = new Set(companies.map((c) => c.slug));
  const onlyInDb = [...existing.keys()].filter((slug) => !inFile.has(slug));

  console.log(`Synced ${companies.length} companies from ${file}`);
  console.log(`  created: ${created}, updated: ${updated}`);
  if (rebaselined.length > 0) {
    console.log(`  new board, next fetch is a quiet baseline: ${rebaselined.join(", ")}`);
  }
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
