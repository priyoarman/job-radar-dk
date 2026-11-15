import { HttpError, type HttpClient } from "./http";

type Rule = { allow: boolean; pattern: string };
type Group = { agents: string[]; rules: Rule[] };

export const ROBOTS_AGENT = "jobradardk";

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (current && (key === "allow" || key === "disallow") && value !== "") {
      current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  return groups;
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export function isPathAllowed(robotsTxt: string, path: string, agent: string = ROBOTS_AGENT): boolean {
  const groups = parseRobots(robotsTxt);
  const own = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const rules = (own.length > 0 ? own : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!patternToRegex(rule.pattern).test(path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

export class RobotsDisallowedError extends Error {
  constructor(readonly url: string) {
    super(`robots-disallowed: ${url} is blocked by robots.txt`);
    this.name = "RobotsDisallowedError";
  }
}

export async function assertAllowedByRobots(http: HttpClient, url: string): Promise<void> {
  const { origin, pathname, search } = new URL(url);
  let robotsTxt: string;
  try {
    robotsTxt = await http.text(`${origin}/robots.txt`);
  } catch (error) {
    if (error instanceof HttpError && error.status >= 400 && error.status < 500) return;
    throw error;
  }
  if (!isPathAllowed(robotsTxt, `${pathname}${search}`)) throw new RobotsDisallowedError(url);
}
