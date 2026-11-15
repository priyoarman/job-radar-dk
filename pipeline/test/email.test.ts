import { describe, expect, it, vi } from "vitest";
import { createResendSender } from "../src/email/send";
import { type EmailJob, type SourceWarning, escapeHtml, renderJobsEmail, subjectFor } from "../src/email/templates";

const job = (title: string, company = "Lunar", location: string | null = "København, Denmark"): EmailJob => ({
  title,
  location,
  url: `https://jobs.example.com/${encodeURIComponent(title)}`,
  company: { name: company },
});

describe("escapeHtml", () => {
  it("escapes the five HTML special characters", () => {
    expect(escapeHtml(`<b>"R&D" isn't</b>`)).toBe("&lt;b&gt;&quot;R&amp;D&quot; isn&#39;t&lt;/b&gt;");
  });

  it("leaves normal text and Danish letters alone", () => {
    expect(escapeHtml("Udvikler i København – æøå")).toBe("Udvikler i København – æøå");
  });
});

describe("subjectFor", () => {
  it.each([
    [[job("A")], "Job Radar: 1 new job (Lunar)"],
    [[job("A"), job("B")], "Job Radar: 2 new jobs (Lunar)"],
    [[job("A"), job("B", "Templafy")], "Job Radar: 2 new jobs (Lunar, Templafy)"],
    [[job("A"), job("B", "Templafy"), job("C", "ATP")], "Job Radar: 3 new jobs (Lunar, Templafy, …)"],
  ])("%#: %s", (jobs, expected) => {
    expect(subjectFor(jobs)).toBe(expected);
  });
});

describe("renderJobsEmail", () => {
  it("lists every job with its title, company, location and link", () => {
    const { html, text } = renderJobsEmail([job("Backend Engineer"), job("Platform Engineer", "Lunar", null)]);
    expect(html).toContain('<a href="https://jobs.example.com/Backend%20Engineer"');
    expect(html).toContain(">Backend Engineer</a>");
    expect(html).toContain("Lunar · København, Denmark");
    expect(html).toContain(">Lunar</div>");
    expect(text).toContain("- Backend Engineer\n  Lunar · København, Denmark\n  https://jobs.example.com/Backend%20Engineer");
    expect(text).toContain("- Platform Engineer\n  Lunar\n");
  });

  it("escapes feed values so a job title cannot inject HTML", () => {
    const evil = { ...job(`<img src=x onerror="alert(1)">`), url: `https://x.com/"><script>alert(1)</script>` };
    const { html } = renderJobsEmail([evil]);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("uses singular wording for one job", () => {
    expect(renderJobsEmail([job("A")]).text.startsWith("1 new job matches your title filter")).toBe(true);
  });
});

describe("renderJobsEmail with warnings", () => {
  const failing: SourceWarning = { slug: "lunar", name: "Lunar", reason: "failing", consecutiveFailures: 3, lastError: "HTTP 404 <gone>" };
  const empty: SourceWarning = { slug: "atp", name: "ATP", reason: "suspicious-empty", consecutiveFailures: 0, lastError: null };

  it("adds a footer listing each source and why it needs attention", () => {
    const { html, text } = renderJobsEmail([job("Backend Engineer")], [failing, empty]);
    expect(html).toContain("⚠️ Sources needing attention");
    expect(html).toContain("<strong>Lunar</strong> failed 3 runs in a row. Last error: HTTP 404 &lt;gone&gt;");
    expect(html).toContain("<strong>ATP</strong> returned 0 jobs but had jobs before.");
    expect(text).toContain("⚠️ Sources needing attention\n- Lunar: failed 3 runs in a row. Last error: HTTP 404 <gone>\n- ATP: returned 0 jobs");
  });

  it("has no footer when every source is healthy", () => {
    expect(renderJobsEmail([job("A")], []).html).not.toContain("Sources needing attention");
  });

  it("builds a warning-only email when there are no jobs", () => {
    const { subject, html } = renderJobsEmail([], [empty]);
    expect(subject).toBe("Job Radar: ⚠️ 1 source needs attention");
    expect(html).toContain("No new jobs this time, but some sources need attention");
    expect(html).not.toContain('<ul style="list-style:none');
  });
});

describe("createResendSender", () => {
  const config = { apiKey: "re_test", from: "Job Radar <onboarding@resend.dev>", to: "me@example.com" };
  const message = { subject: "S", html: "<p>H</p>", text: "T" };

  it("sends from and to the configured addresses and returns the email id", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "email_123" }, error: null, headers: null });
    const sendEmail = createResendSender(config, { emails: { send } } as never);
    await expect(sendEmail(message)).resolves.toEqual({ id: "email_123" });
    expect(send).toHaveBeenCalledWith({ from: config.from, to: config.to, subject: "S", html: "<p>H</p>", text: "T" }, undefined);
  });

  it("passes an idempotency key through to Resend", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "email_123" }, error: null, headers: null });
    await createResendSender(config, { emails: { send } } as never)(message, { idempotencyKey: "run-1" });
    expect(send).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: "run-1" });
  });

  it("throws when Resend returns an error instead of throwing one itself", async () => {
    const error = { name: "validation_error", message: "You can only send testing emails to your own email address", statusCode: 403 };
    const send = vi.fn().mockResolvedValue({ data: null, error, headers: null });
    await expect(createResendSender(config, { emails: { send } } as never)(message)).rejects.toThrow(
      "Resend refused the email (HTTP 403): validation_error: You can only send testing emails to your own email address",
    );
  });
});
