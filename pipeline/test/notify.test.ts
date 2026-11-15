import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type NotifyJob, notify } from "../src/steps/notify";

const job = (id: string): NotifyJob => ({
  id,
  title: `Backend Engineer ${id}`,
  location: "København, Denmark",
  url: `https://example.com/jobs/${id}`,
  company: { name: "Example Co", slug: "example-co" },
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

describe("notify in dry-run mode", () => {
  it("prints one line per job it would email, and sends nothing", async () => {
    const result = await notify([job("1"), job("2")], { dryRun: true });
    expect(result).toEqual({ jobs: 2, emailsSent: 0 });
    const lines = out.mock.calls.map(([line]) => String(line));
    expect(lines[0]).toBe('notify.dry-run {"wouldEmail":true,"jobs":2}');
    expect(lines.slice(1)).toEqual([
      'notify.would-send {"company":"example-co","title":"Backend Engineer 1","location":"København, Denmark","url":"https://example.com/jobs/1"}',
      'notify.would-send {"company":"example-co","title":"Backend Engineer 2","location":"København, Denmark","url":"https://example.com/jobs/2"}',
    ]);
  });

  it("says there is nothing to send when there are no jobs", async () => {
    await expect(notify([], { dryRun: true })).resolves.toEqual({ jobs: 0, emailsSent: 0 });
    expect(out).toHaveBeenCalledExactlyOnceWith('notify.dry-run {"wouldEmail":false,"jobs":0}');
  });
});

describe("notify outside dry-run mode", () => {
  it("warns that email is not set up yet and sends nothing", async () => {
    await expect(notify([job("1")], { dryRun: false })).resolves.toEqual({ jobs: 1, emailsSent: 0 });
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^WARN notify\.not-ready /);
  });
});
