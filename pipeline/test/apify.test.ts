import { describe, expect, it, vi } from "vitest";
import { createApifyRunner, runUrl } from "../src/lib/apify";
import { HttpError } from "../src/lib/http";

const options = { token: "apify_api_secret", maxChargeUsd: 0.25, timeoutSecs: 240 };

describe("runUrl", () => {
  it("calls the run-and-return-items endpoint with a timeout and a cost cap, but no token", () => {
    const url = runUrl("valig/linkedin-jobs-scraper", options);
    expect(url).toBe(
      "https://api.apify.com/v2/acts/valig~linkedin-jobs-scraper/run-sync-get-dataset-items?timeout=240&maxTotalChargeUsd=0.25",
    );
    expect(url).not.toContain("secret");
  });
});

describe("createApifyRunner", () => {
  it("posts the input with the token in a header and returns the items", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json([{ id: "1" }, { id: "2" }]));
    const run = createApifyRunner(options, fetchImpl);
    await expect(run("valig/linkedin-jobs-scraper", { keywords: "React" })).resolves.toEqual([{ id: "1" }, { id: "2" }]);
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer apify_api_secret", "Content-Type": "application/json" },
      body: JSON.stringify({ keywords: "React" }),
    });
  });

  it("throws an HttpError without the token when Apify refuses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 402 }));
    const error = await createApifyRunner(options, fetchImpl)("valig/linkedin-jobs-scraper", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(402);
    expect((error as HttpError).message).not.toContain("secret");
  });

  it("throws when the answer is not a list", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ error: "x" }));
    await expect(createApifyRunner(options, fetchImpl)("a/b", {})).rejects.toThrow("did not return a list");
  });
});
