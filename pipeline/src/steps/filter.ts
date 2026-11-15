import { isAbroadOnly } from "./location";

export type FilterResult = { pass: true } | { pass: false; reason: string };

export type FilterInput = { title: string; location?: string | null };

type Match = "word" | "prefix" | "suffix";
type Rule = { label: string; regex: RegExp };

const NOT_LETTER_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_LETTER_AFTER = "(?![\\p{L}\\p{N}])";

function rule(text: string, match: Match = "word", options: { caseSensitive?: boolean } = {}): Rule {
  const before = match === "suffix" ? "" : NOT_LETTER_BEFORE;
  const after = match === "prefix" ? "" : NOT_LETTER_AFTER;
  const flags = options.caseSensitive ? "u" : "iu";
  return { label: text.toLowerCase().replace(/ /g, "-"), regex: new RegExp(`${before}${text}${after}`, flags) };
}

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
];

const DEV_RULES = [
  rule("developer"),
  rule("engineer"),
  rule("engineering"),
  rule("frontend"),
  rule("backend"),
  rule("fullstack"),
  rule("udvikler", "suffix"),
  rule("ai"),
];

const TECH_RULES = [
  rule("software", "prefix"),
  rule("data"),
  rule("IT", "word", { caseSensitive: true }),
  rule("tech"),
  rule("technology"),
  rule("programmer"),
  rule("web"),
  rule("cloud"),
  rule("devops"),
  rule("ml"),
];

const ENTRY_RULES = [
  rule("student", "prefix"),
  rule("junior"),
  rule("graduate", "prefix"),
  rule("intern"),
  rule("internship"),
  rule("trainee"),
  rule("praktikant", "suffix"),
  rule("nyuddannet"),
  rule("dimittend"),
];

const matches = (rules: Rule[], text: string) => rules.some((r) => r.regex.test(text));

export function normalizeTitle(title: string): string {
  return title
    .replace(/\bfull[\s-]+stack\b/gi, "fullstack")
    .replace(/\bfront[\s-]+end\b/gi, "frontend")
    .replace(/\bback[\s-]+end\b/gi, "backend");
}

function checkTitle(rawTitle: string): FilterResult {
  const title = normalizeTitle(rawTitle);
  const seniority = SENIORITY_RULES.find((r) => r.regex.test(title));
  if (seniority) return { pass: false, reason: `title:${seniority.label}` };
  if (matches(DEV_RULES, title)) return { pass: true };
  if (matches(ENTRY_RULES, title)) {
    return matches(TECH_RULES, title) ? { pass: true } : { pass: false, reason: "title:entry-without-tech" };
  }
  return { pass: false, reason: "title:no-dev-keyword" };
}

export function filterJob(job: FilterInput): FilterResult {
  const title = checkTitle(job.title);
  if (!title.pass) return title;
  if (isAbroadOnly(job.location ?? null)) return { pass: false, reason: "location:abroad" };
  return { pass: true };
}
