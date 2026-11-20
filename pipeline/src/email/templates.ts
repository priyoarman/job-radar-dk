import type { EmailMessage } from "./send";

export type EmailJob = {
  title: string;
  location: string | null;
  url: string;
  employer?: string | null;
  company: { name: string };
};

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

function employerOf(job: EmailJob): string {
  return job.employer || job.company.name;
}

function sourceNote(job: EmailJob): string {
  return job.employer && job.employer !== job.company.name ? ` · via ${job.company.name}` : "";
}

export function subjectFor(jobs: readonly EmailJob[]): string {
  const count = `${jobs.length} new ${jobs.length === 1 ? "job" : "jobs"}`;
  const companies = [...new Set(jobs.map(employerOf))];
  const shown = companies.slice(0, 2).join(", ");
  const more = companies.length > 2 ? ", …" : "";
  return `Job Radar: ${count} (${shown}${more})`;
}

function jobHtml(job: EmailJob): string {
  const location = job.location ? ` · ${escapeHtml(job.location)}` : "";
  return [
    '<li style="margin:0 0 16px">',
    `<a href="${escapeHtml(job.url)}" style="font-size:16px;font-weight:600;color:#1a56db">${escapeHtml(job.title)}</a>`,
    `<div style="color:#555">${escapeHtml(employerOf(job))}${location}${escapeHtml(sourceNote(job))}</div>`,
    "</li>",
  ].join("");
}

function jobText(job: EmailJob): string {
  const location = job.location ? ` · ${job.location}` : "";
  return `- ${job.title}\n  ${employerOf(job)}${location}${sourceNote(job)}\n  ${job.url}`;
}

export type SourceWarning = {
  slug: string;
  name: string;
  reason: "failing" | "suspicious-empty" | "robots-disallowed";
  consecutiveFailures: number;
  lastError: string | null;
};

function warningLine(warning: SourceWarning): string {
  if (warning.reason === "robots-disallowed") {
    return "is blocked by its robots.txt, so it is skipped. Find another source for it or set active: false.";
  }
  if (warning.reason === "suspicious-empty") {
    return "returned 0 jobs but had jobs before. The feed or adapter may have changed.";
  }
  const error = warning.lastError ? ` Last error: ${warning.lastError}` : "";
  return `failed ${warning.consecutiveFailures} runs in a row.${error}`;
}

export function warningsSubject(warnings: readonly SourceWarning[]): string {
  const count = `${warnings.length} ${warnings.length === 1 ? "source needs" : "sources need"} attention`;
  return `Job Radar: ⚠️ ${count}`;
}

function warningsHtml(warnings: readonly SourceWarning[]): string {
  if (warnings.length === 0) return "";
  const items = warnings
    .map((w) => `<li style="margin:0 0 8px"><strong>${escapeHtml(w.name)}</strong> ${escapeHtml(warningLine(w))}</li>`)
    .join("");
  return [
    '<div style="margin-top:24px;padding:12px 16px;background:#fff8e1;border-left:4px solid #f5a623">',
    '<h3 style="font-size:15px;margin:0 0 8px">⚠️ Sources needing attention</h3>',
    `<ul style="padding-left:18px;margin:0">${items}</ul>`,
    "</div>",
  ].join("");
}

function warningsText(warnings: readonly SourceWarning[]): string[] {
  if (warnings.length === 0) return [];
  return ["", "⚠️ Sources needing attention", ...warnings.map((w) => `- ${w.name}: ${warningLine(w)}`)];
}

export function renderJobsEmail(jobs: readonly EmailJob[], warnings: readonly SourceWarning[] = []): EmailMessage {
  const heading =
    jobs.length > 0
      ? `${jobs.length} new ${jobs.length === 1 ? "job" : "jobs"} for you`
      : "No new jobs this time, but some sources need attention";
  const list = jobs.length > 0 ? `<ul style="list-style:none;padding:0">${jobs.map(jobHtml).join("")}</ul>` : "";
  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:600px;color:#111">',
    `<h2 style="font-size:18px">${heading}</h2>`,
    list,
    warningsHtml(warnings),
    '<p style="color:#888;font-size:12px">Sent by Job Radar DK. You review and apply to every job yourself.</p>',
    "</div>",
  ].join("");
  const text = [heading, "", ...jobs.map(jobText), ...warningsText(warnings), "", "Sent by Job Radar DK."].join("\n");
  const subject = jobs.length > 0 ? subjectFor(jobs) : warningsSubject(warnings);
  return { subject, html, text };
}
