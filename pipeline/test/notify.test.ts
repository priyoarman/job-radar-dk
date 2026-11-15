import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type NotifyDeps, type NotifyJob, idempotencyKeyFor, notify } from "../src/steps/notify";

const job = (id: string, company = "Example Co"): NotifyJob => ({
  id,
  title: `Backend Engineer ${id}`,
  location: "København, Denmark",
  url: `https://example.com/jobs/${id}`,
  company: { name: company, slug: company.toLowerCase().replace(/ /g, "-") },
});

let out: MockInstance<typeof console.log>;

beforeEach(() => {
  out = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function deps(overrides: Partial<NotifyDeps> = {}): NotifyDeps {
  return {
    dryRun: false,
    send: vi.fn().mockResolvedValue({ id: "email_1" }),
    markNotified: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("notify in dry-run mode", () => {
  it("prints one line per job it would email, and sends or marks nothing", async () => {
    const d = deps({ dryRun: true });
    const result = await notify([job("1"), job("2")], d);
    expect(result).toEqual({ jobs: 2, emailsSent: 0 });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.markNotified).not.toHaveBeenCalled();
    const lines = out.mock.calls.map(([line]) => String(line));
    expect(lines[0]).toBe('notify.dry-run {"wouldEmail":true,"jobs":2}');
    expect(lines[1]).toBe(
      'notify.would-send {"company":"example-co","title":"Backend Engineer 1","location":"København, Denmark","url":"https://example.com/jobs/1"}',
    );
  });

  it("works without a sender", async () => {
    await expect(notify([job("1")], deps({ dryRun: true, send: null }))).resolves.toEqual({ jobs: 1, emailsSent: 0 });
  });
});

describe("notify for real", () => {
  it("sends one email for all jobs, then marks exactly those jobs", async () => {
    const d = deps();
    const result = await notify([job("1"), job("2", "Lunar")], d);
    expect(result).toEqual({ jobs: 2, emailsSent: 1 });
    expect(d.send).toHaveBeenCalledOnce();
    const [message, options] = vi.mocked(d.send!).mock.calls[0]!;
    expect(message.subject).toBe("Job Radar: 2 new jobs (Example Co, Lunar)");
    expect(message.html).toContain("Backend Engineer 1");
    expect(options).toEqual({ idempotencyKey: idempotencyKeyFor(["1", "2"]) });
    expect(d.markNotified).toHaveBeenCalledExactlyOnceWith(["1", "2"], message.subject, "email_1");
  });

  it("sends nothing when there are no new jobs", async () => {
    const d = deps();
    await expect(notify([], d)).resolves.toEqual({ jobs: 0, emailsSent: 0 });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.markNotified).not.toHaveBeenCalled();
  });

  it("marks nothing when sending fails, so the next run retries", async () => {
    const d = deps({ send: vi.fn().mockRejectedValue(new Error("Resend refused the email (HTTP 500)")) });
    await expect(notify([job("1")], d)).rejects.toThrow("HTTP 500");
    expect(d.markNotified).not.toHaveBeenCalled();
  });

  it("refuses to run without a sender when dry run is off", async () => {
    await expect(notify([job("1")], deps({ send: null }))).rejects.toThrow("not configured");
  });
});

describe("idempotencyKeyFor", () => {
  it("gives the same key for the same jobs in any order", () => {
    expect(idempotencyKeyFor(["b", "a"])).toBe(idempotencyKeyFor(["a", "b"]));
  });

  it("gives a different key when the jobs differ", () => {
    expect(idempotencyKeyFor(["a"])).not.toBe(idempotencyKeyFor(["a", "b"]));
  });

  it("stays short enough for Resend", () => {
    expect(idempotencyKeyFor(Array.from({ length: 500 }, (_, i) => `job-${i}`)).length).toBeLessThan(256);
  });
});
