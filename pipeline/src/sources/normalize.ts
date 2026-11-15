import { ZodError } from "zod";
import { log } from "../lib/logger";
import type { AdapterCompany, NormalizedJob, SourceAdapter } from "./types";

function describeError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

export function normalizeJobs<Raw>(
  adapter: SourceAdapter<Raw>,
  raws: Raw[],
  company: AdapterCompany,
): { jobs: NormalizedJob[]; skipped: number } {
  const jobs: NormalizedJob[] = [];
  let skipped = 0;
  raws.forEach((raw, index) => {
    try {
      jobs.push(adapter.normalize(raw, company));
    } catch (error) {
      skipped++;
      log.warn("normalize.skipped", {
        company: company.slug,
        source: adapter.name,
        index,
        reason: describeError(error),
      });
    }
  });
  return { jobs, skipped };
}
