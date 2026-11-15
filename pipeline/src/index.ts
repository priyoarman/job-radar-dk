import { createPrismaClient } from "@jobradar/db";
import { loadConfig } from "./config";
import { createHttpClient } from "./lib/http";
import { createResendSender } from "./email/send";
import { log } from "./lib/logger";
import { createProcessCompany, fetchCompanies, sleep } from "./steps/fetchCompanies";
import { createRecordNotification, findNotifyInput, notify } from "./steps/notify";
import { runTriggerFor } from "./steps/recordRun";
import { runPipeline } from "./steps/runPipeline";

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = createPrismaClient(config.DATABASE_URL);
  try {
    log.info("config.loaded", { dryRun: config.DRY_RUN });
    const send =
      config.DRY_RUN || !config.RESEND_API_KEY || !config.EMAIL_TO
        ? null
        : createResendSender({ apiKey: config.RESEND_API_KEY, from: config.EMAIL_FROM, to: config.EMAIL_TO });
    const record = createRecordNotification(prisma, () => new Date());
    const processCompany = createProcessCompany(prisma, createHttpClient({ userAgent: config.USER_AGENT }));
    const status = await runPipeline({
      prisma,
      trigger: runTriggerFor(config.GITHUB_EVENT_NAME),
      gitSha: config.GITHUB_SHA ?? null,
      now: () => new Date(),
      fetchAll: (companies) =>
        fetchCompanies(companies, {
          minIntervalHours: config.MIN_FETCH_INTERVAL_HOURS,
          pauseMs: 1_000,
          now: () => new Date(),
          sleep,
          processCompany,
        }),
      notify: async () => notify(await findNotifyInput(prisma, new Date()), { dryRun: config.DRY_RUN, send, record }),
    });
    if (status === "FAILED") process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  log.error("run.crashed", { error });
  process.exitCode = 1;
});
