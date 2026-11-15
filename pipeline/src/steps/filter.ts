export type FilterResult = { pass: true } | { pass: false; reason: string };

type Match = "word" | "prefix" | "suffix";
type Rule = { label: string; text: string; match: Match };

const NOT_LETTER_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_LETTER_AFTER = "(?![\\p{L}\\p{N}])";

function toRegex({ text, match }: Rule): RegExp {
  const before = match === "suffix" ? "" : NOT_LETTER_BEFORE;
  const after = match === "prefix" ? "" : NOT_LETTER_AFTER;
  return new RegExp(`${before}${text}${after}`, "iu");
}

const rule = (text: string, match: Match = "word", label = text.replace(/ /g, "-")): Rule => ({
  label,
  text,
  match,
});

const SENIORITY_RULES = [
  rule("senior", "prefix"),
  rule("sr"),
  rule("lead"),
  rule("principal"),
  rule("staff"),
  rule("manager"),
  rule("head of"),
  rule("director"),
  rule("chief"),
  rule("vp"),
  rule("ledende"),
  rule("leder", "suffix"),
  rule("chef", "suffix"),
].map((r) => ({ ...r, regex: toRegex(r) }));

const DEV_RULES = [
  rule("developer"),
  rule("engineer"),
  rule("engineering"),
  rule("frontend"),
  rule("backend"),
  rule("fullstack"),
  rule("udvikler", "suffix"),
  rule("ai"),
  rule("student", "prefix"),
  rule("junior"),
  rule("graduate", "prefix"),
  rule("intern"),
  rule("internship"),
  rule("trainee"),
  rule("praktikant"),
  rule("nyuddannet"),
  rule("dimittend"),
].map((r) => ({ ...r, regex: toRegex(r) }));

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\bfull[\s-]+stack\b/g, "fullstack")
    .replace(/\bfront[\s-]+end\b/g, "frontend")
    .replace(/\bback[\s-]+end\b/g, "backend");
}

export function filterJob(job: { title: string }): FilterResult {
  const title = normalizeTitle(job.title);
  const seniority = SENIORITY_RULES.find((r) => r.regex.test(title));
  if (seniority) return { pass: false, reason: `title:${seniority.label}` };
  if (!DEV_RULES.some((r) => r.regex.test(title))) return { pass: false, reason: "title:no-dev-keyword" };
  return { pass: true };
}
