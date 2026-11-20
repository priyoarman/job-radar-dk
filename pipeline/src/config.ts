import { z } from "zod";

const envSchema = z
  .object({
    DATABASE_URL: z.url({
      protocol: /^postgres(ql)?$/,
      error: (issue) => (issue.input === undefined ? "required" : "must be a postgresql:// URL"),
    }),
    DRY_RUN: z.stringbool().default(false),
    RESEND_API_KEY: z.string().startsWith("re_").optional(),
    EMAIL_FROM: z.string().default("Job Radar <onboarding@resend.dev>"),
    EMAIL_TO: z.email().optional(),
    USER_AGENT: z.string().default("JobRadarDK/1.0 (personal job alert bot)"),
    MIN_FETCH_INTERVAL_HOURS: z.coerce.number().positive().default(2.5),
    APP_BASE_URL: z.url().default("http://localhost:3000"),
    GITHUB_EVENT_NAME: z.string().optional(),
    TRIGGER_SOURCE: z.string().optional(),
    GITHUB_SHA: z.string().optional(),
    HEALTHCHECK_URL: z.url({ protocol: /^https$/ }).optional(),
    APIFY_TOKEN: z.string().min(1).optional(),
    APIFY_MAX_CHARGE_USD: z.coerce.number().positive().default(0.25),
  })
  .superRefine(
    (env, ctx) => {
      if (env.DRY_RUN === true) return;
      for (const key of ["RESEND_API_KEY", "EMAIL_TO"] as const) {
        if (env[key] === undefined) {
          ctx.addIssue({ code: "custom", path: [key], message: "required unless DRY_RUN=true" });
        }
      }
    },
    { when: () => true },
  );

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const nonEmpty = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
  const result = envSchema.safeParse(nonEmpty);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment variables:\n${lines.join("\n")}`);
  }
  return result.data;
}
