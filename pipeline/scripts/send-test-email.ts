import { loadConfig } from "../src/config";
import { createResendSender } from "../src/email/send";
import { renderJobsEmail } from "../src/email/templates";
import { log } from "../src/lib/logger";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.RESEND_API_KEY || !config.EMAIL_TO) {
    throw new Error("Set RESEND_API_KEY and EMAIL_TO in .env to send a test email.");
  }

  const message = renderJobsEmail([
    {
      title: "TEST: Junior Full Stack Developer",
      location: "København, Denmark",
      url: "https://example.com/jobs/1-junior-full-stack-developer",
      postedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      company: { name: "Example Co" },
    },
    {
      title: "TEST: Frontend Developer (React/TypeScript)",
      location: "Copenhagen, Denmark",
      url: "https://example.com/jobs/3-frontend-developer",
      employer: "Example Employer A/S",
      postedAt: new Date(new Date().setUTCHours(0, 0, 0, 0)),
      company: { name: "LinkedIn" },
    },
    {
      title: "TEST: Student Developer <AI & Data>",
      location: null,
      url: "https://example.com/jobs/2-student-developer",
      postedAt: null,
      firstSeenAt: new Date(),
      company: { name: "Another Co" },
    },
  ]);

  const send = createResendSender({ apiKey: config.RESEND_API_KEY, from: config.EMAIL_FROM, to: config.EMAIL_TO });
  const { id } = await send({ ...message, subject: `[TEST] ${message.subject}` });
  log.info("email.test-sent", { id, subject: `[TEST] ${message.subject}` });
}

main().catch((error: unknown) => {
  log.error("email.test-failed", { error });
  process.exitCode = 1;
});
