import type { EmailMessage } from "./send";

export type EmailJob = {
  title: string;
  location: string | null;
  url: string;
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

export function subjectFor(jobs: readonly EmailJob[]): string {
  const count = `${jobs.length} new ${jobs.length === 1 ? "job" : "jobs"}`;
  const companies = [...new Set(jobs.map((job) => job.company.name))];
  const shown = companies.slice(0, 2).join(", ");
  const more = companies.length > 2 ? ", …" : "";
  return `Job Radar: ${count} (${shown}${more})`;
}

function jobHtml(job: EmailJob): string {
  const location = job.location ? ` · ${escapeHtml(job.location)}` : "";
  return [
    '<li style="margin:0 0 16px">',
    `<a href="${escapeHtml(job.url)}" style="font-size:16px;font-weight:600;color:#1a56db">${escapeHtml(job.title)}</a>`,
    `<div style="color:#555">${escapeHtml(job.company.name)}${location}</div>`,
    "</li>",
  ].join("");
}

function jobText(job: EmailJob): string {
  const location = job.location ? ` · ${job.location}` : "";
  return `- ${job.title}\n  ${job.company.name}${location}\n  ${job.url}`;
}

export function renderJobsEmail(jobs: readonly EmailJob[]): EmailMessage {
  const heading = `${jobs.length} new ${jobs.length === 1 ? "job matches" : "jobs match"} your title filter`;
  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:600px;color:#111">',
    `<h2 style="font-size:18px">${heading}</h2>`,
    `<ul style="list-style:none;padding:0">${jobs.map(jobHtml).join("")}</ul>`,
    '<p style="color:#888;font-size:12px">Sent by Job Radar DK. You review and apply to every job yourself.</p>',
    "</div>",
  ].join("");
  const text = [heading, "", ...jobs.map(jobText), "", "Sent by Job Radar DK."].join("\n");
  return { subject: subjectFor(jobs), html, text };
}
