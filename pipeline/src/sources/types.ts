import type { Company, SourceType } from "@jobradar/db";
import { z } from "zod";
import type { HttpClient } from "../lib/http";

export const REMOTE_TYPES = ["remote", "hybrid", "onsite"] as const;

export const normalizedJobSchema = z.object({
  externalId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  company: z.string().trim().min(1),
  location: z.string().trim().min(1).nullable(),
  remoteType: z.enum(REMOTE_TYPES).nullable(),
  description: z.string(),
  url: z.url({ protocol: /^https?$/ }),
  postedAt: z.date().nullable(),
});

export type NormalizedJob = z.infer<typeof normalizedJobSchema>;

export type AdapterCompany = Pick<Company, "slug" | "name" | "sourceKey">;

export interface SourceAdapter<Raw> {
  readonly name: SourceType;
  fetchJobs(company: AdapterCompany, http: HttpClient): Promise<Raw[]>;
  normalize(raw: Raw, company: AdapterCompany): NormalizedJob;
}
