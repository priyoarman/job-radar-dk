import { z } from "zod";
import { SourceType } from "../generated/prisma/enums";

export const SUPPORTED_SOURCES: readonly SourceType[] = [SourceType.TEAMTAILOR, SourceType.GREENHOUSE, SourceType.LEVER, SourceType.ASHBY, SourceType.RECRUITEE, SourceType.WORKABLE, SourceType.WORKDAY, SourceType.SUCCESSFACTORS, SourceType.EMPLY, SourceType.HRMANAGER, SourceType.CUSTOM, SourceType.LINKEDIN, SourceType.JOBINDEX, SourceType.THEHUB, SourceType.JOBBANK];

const companySchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase letters, numbers and dashes"),
  name: z.string().trim().min(1),
  source: z
    .enum(SourceType)
    .refine((s) => SUPPORTED_SOURCES.includes(s), {
      error: (issue) => `no adapter for source "${String(issue.input)}" yet`,
    }),
  sourceKey: z.string().trim().min(1),
  careersUrl: z.url().optional(),
  city: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  active: z.boolean().default(true),
  notes: z.string().optional(),
}).strict();

const companiesSchema = z.array(companySchema).superRefine((companies, ctx) => {
  const seenSlugs = new Set<string>();
  const seenKeys = new Set<string>();
  companies.forEach((c, i) => {
    if (seenSlugs.has(c.slug)) {
      ctx.addIssue({ code: "custom", path: [i, "slug"], message: `duplicate slug "${c.slug}"` });
    }
    const key = `${c.source}:${c.sourceKey}`;
    if (seenKeys.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: [i, "sourceKey"],
        message: `duplicate source + sourceKey "${key}"`,
      });
    }
    seenSlugs.add(c.slug);
    seenKeys.add(key);
  });
});

export type CompanySeed = z.infer<typeof companySchema>;

export function parseCompanies(data: unknown): CompanySeed[] {
  const result = companiesSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid companies file:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function boardChanged(
  existing: Pick<CompanySeed, "source" | "sourceKey"> | undefined,
  seed: Pick<CompanySeed, "source" | "sourceKey">,
): boolean {
  return existing !== undefined && (existing.source !== seed.source || existing.sourceKey !== seed.sourceKey);
}
