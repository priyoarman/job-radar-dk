import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceWarning } from "../src/email/templates";
import {
  type EmailPlan,
  type NotifyDeps,
  type NotifyInput,
  type NotifyJob,
  idempotencyKeyFor,
  notify,
  planEmail,
  warningsFrom,
} from "../src/steps/notify";

const NOW = new Date("2026-11-16T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const job = (id: string, company = "Example Co"): NotifyJob => ({
  id,
  title: `Backend Engineer ${id}`,
  location: "København, Denmark",
  url: `https://example.com/jobs/${id}`,
  company: { name: company, slug: company.toLowerCase().replace(/ /g, "-") },
});

const failing: SourceWarning = { slug: "lunar", name: "Lunar", reason: "failing", consecutiveFailures: 3, lastError: "HTTP 500" };
const empty: SourceWarning = { slug: "atp", name: "ATP", reason: "suspicious-empty", consecutiveFailures: 0, lastError: null };

const input = (overrides: Partial<NotifyInput> = {}): NotifyInput => ({
  jobs: [],
  warnings: [],
  lastHealthAlertAt: null,
  now: NOW,
  ...overrides,
});

let out: MockInstance<typeof console.log>;
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  out = vi.spyOn(console, "log").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function deps(overrides: Partial<NotifyDeps> = {}): NotifyDeps {
  return {
    dryRun: false,
    send: vi.fn().mockResolvedValue({ id: "email_1" }),
    record: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("warningsFrom", () => {
  const company = { slug: "x", name: "X", consecutiveFailures: 0, lastError: null, lastFetchStatus: "OK" as const };

  it.each([
    [{ consecutiveFailures: 2, lastFetchStatus: "ERROR" as const }, []],
    [{ consecutiveFailures: 3, lastError: "HTTP 404", lastFetchStatus: "ERROR" as const }, ["failing"]],
    [{ consecutiveFailures: 7, lastFetchStatus: "ERROR" as const }, ["failing"]],
    [{ lastFetchStatus: "SUSPICIOUS_EMPTY" as const }, ["suspicious-empty"]],
    [{ lastFetchStatus: "SKIPPED_ROBOTS" as const, lastError: "robots-disallowed: x" }, ["robots-disallowed"]],
    [{ lastFetchStatus: "EMPTY" as const }, []],
    [{ lastFetchStatus: null }, []],
  ])("%j → %j", (overrides, reasons) => {
    expect(warningsFrom([{ ...company, ...overrides }]).map((w) => w.reason)).toEqual(reasons);
  });
});

describe("planEmail", () => {
  it("sends a summary when there are new jobs, with any warnings in the footer", () => {
    expect(planEmail(input({ jobs: [job("1")], warnings: [failing] }))).toEqual({
      kind: "RUN_SUMMARY",
      jobs: [job("1")],
      warnings: [failing],
    });
  });

  it("sends a summary even if a warning email went out recently", () => {
    expect(planEmail(input({ jobs: [job("1")], warnings: [failing], lastHealthAlertAt: hoursAgo(1) })).kind).toBe(
      "RUN_SUMMARY",
    );
  });

  it("sends nothing when there are no jobs and no warnings", () => {
    expect(planEmail(input())).toEqual({ kind: "NONE", reason: "nothing-new" });
  });

  it.each([
    [null, "HEALTH_ALERT"],
    [hoursAgo(25), "HEALTH_ALERT"],
    [hoursAgo(24), "HEALTH_ALERT"],
    [hoursAgo(23), "NONE"],
    [hoursAgo(3), "NONE"],
  ])("warning-only email when last alert was %s → %s", (lastHealthAlertAt, kind) => {
    expect(planEmail(input({ warnings: [empty], lastHealthAlertAt })).kind).toBe(kind);
  });
});

describe("idempotencyKeyFor", () => {
  const summary = (ids: string[], warnings: SourceWarning[] = []) =>
    ({ kind: "RUN_SUMMARY", jobs: ids.map((id) => job(id)), warnings }) as const;

  it("is the same for the same jobs in any order", () => {
    expect(idempotencyKeyFor(summary(["b", "a"]), NOW)).toBe(idempotencyKeyFor(summary(["a", "b"]), NOW));
  });

  it("changes when the jobs change", () => {
    expect(idempotencyKeyFor(summary(["a"]), NOW)).not.toBe(idempotencyKeyFor(summary(["a", "b"]), NOW));
  });

  it("changes when the footer warnings change, so Resend never sees one key with two contents", () => {
    expect(idempotencyKeyFor(summary(["a"]), NOW)).not.toBe(idempotencyKeyFor(summary(["a"], [failing]), NOW));
  });

  it("is the same for a warning email on the same day, and new the next day", () => {
    const alert: EmailPlan & { kind: "HEALTH_ALERT" } = { kind: "HEALTH_ALERT", warnings: [failing] };
    expect(idempotencyKeyFor(alert, NOW)).toBe(idempotencyKeyFor(alert, hoursAgo(3)));
    expect(idempotencyKeyFor(alert, NOW)).not.toBe(idempotencyKeyFor(alert, hoursAgo(24)));
  });

  it("stays short enough for Resend", () => {
    const many = summary(Array.from({ length: 500 }, (_, i) => `job-${i}`));
    expect(idempotencyKeyFor(many, NOW).length).toBeLessThan(256);
  });
});

describe("notify in dry-run mode", () => {
  it("prints the plan, each job and each warning, and sends or records nothing", async () => {
    const d = deps({ dryRun: true, send: null });
    const result = await notify(input({ jobs: [job("1")], warnings: [failing] }), d);
    expect(result).toEqual({ jobs: 1, emailsSent: 0 });
    expect(d.record).not.toHaveBeenCalled();
    const lines = out.mock.calls.map(([line]) => String(line));
    expect(lines[0]).toBe('notify.dry-run {"plan":"RUN_SUMMARY","jobs":1,"warnings":1}');
    expect(lines[1]).toMatch(/^notify\.would-send .*"title":"Backend Engineer 1"/);
    expect(String(warn.mock.calls[0]?.[0])).toBe('WARN notify.would-warn {"company":"lunar","reason":"failing","lastError":"HTTP 500"}');
  });
});

describe("notify for real", () => {
  it("sends one summary with a warnings footer, then records it with the jobs", async () => {
    const d = deps();
    const result = await notify(input({ jobs: [job("1"), job("2", "Lunar")], warnings: [failing] }), d);
    expect(result).toEqual({ jobs: 2, emailsSent: 1 });
    const [message] = vi.mocked(d.send!).mock.calls[0]!;
    expect(message.subject).toBe("Job Radar: 2 new jobs (Example Co, Lunar)");
    expect(message.html).toContain("Sources needing attention");
    expect(d.record).toHaveBeenCalledExactlyOnceWith("RUN_SUMMARY", message.subject, "email_1", ["1", "2"]);
  });

  it("sends a warning-only email and records it as a health alert without jobs", async () => {
    const d = deps();
    await expect(notify(input({ warnings: [failing, empty] }), d)).resolves.toEqual({ jobs: 0, emailsSent: 1 });
    const [message] = vi.mocked(d.send!).mock.calls[0]!;
    expect(message.subject).toBe("Job Radar: ⚠️ 2 sources need attention");
    expect(d.record).toHaveBeenCalledExactlyOnceWith("HEALTH_ALERT", message.subject, "email_1", []);
  });

  it("does not repeat a warning-only email within a day", async () => {
    const d = deps();
    await expect(notify(input({ warnings: [failing], lastHealthAlertAt: hoursAgo(3) }), d)).resolves.toEqual({
      jobs: 0,
      emailsSent: 0,
    });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("sends nothing when there is nothing to say", async () => {
    const d = deps();
    await notify(input(), d);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.record).not.toHaveBeenCalled();
  });

  it("records nothing when sending fails, so the next run retries", async () => {
    const d = deps({ send: vi.fn().mockRejectedValue(new Error("HTTP 500")) });
    await expect(notify(input({ jobs: [job("1")] }), d)).rejects.toThrow("HTTP 500");
    expect(d.record).not.toHaveBeenCalled();
  });

  it("refuses to run without a sender when dry run is off", async () => {
    await expect(notify(input({ jobs: [job("1")] }), deps({ send: null }))).rejects.toThrow("not configured");
  });
});
