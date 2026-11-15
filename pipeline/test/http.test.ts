import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, createHttpClient, fetchJson, fetchText } from "../src/lib/http";

const URL = "https://example.teamtailor.com/jobs.rss";
const options = { userAgent: "JobRadarDK/test", retryDelayMs: 0 };

function mockFetch(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchText", () => {
  it("returns the body of a 200 response", async () => {
    const fetchMock = mockFetch(new Response("<rss/>", { status: 200 }));
    await expect(fetchText(URL, options)).resolves.toBe("<rss/>");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the User-Agent header", async () => {
    const fetchMock = mockFetch(new Response("ok"));
    await fetchText(URL, options);
    expect(fetchMock).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({ headers: { "User-Agent": "JobRadarDK/test" } }),
    );
  });

  it("retries once after a 500 and returns the second response", async () => {
    const fetchMock = mockFetch(new Response("down", { status: 500 }), new Response("<rss/>"));
    await expect(fetchText(URL, options)).resolves.toBe("<rss/>");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after a second 5xx and throws the status", async () => {
    const fetchMock = mockFetch(new Response("", { status: 502 }), new Response("", { status: 503 }));
    const error = await fetchText(URL, options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 503, url: URL });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([404, 403, 429])("throws on %i without retrying", async (status) => {
    const fetchMock = mockFetch(new Response("", { status }));
    await expect(fetchText(URL, options)).rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once after a network error", async () => {
    const fetchMock = mockFetch(new TypeError("fetch failed"), new Response("<rss/>"));
    await expect(fetchText(URL, options)).resolves.toBe("<rss/>");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts a request that takes longer than the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    );
    await expect(fetchText(URL, { ...options, timeoutMs: 20 })).rejects.toThrow(/timeout|aborted/i);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("waits before retrying", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = mockFetch(new Response("", { status: 500 }), new Response("ok"));
      const promise = fetchText(URL, { userAgent: "x" });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(promise).resolves.toBe("ok");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

const API = "https://boards-api.greenhouse.io/v1/boards/example/jobs";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("fetchJson", () => {
  it("parses a JSON response", async () => {
    mockFetch(json({ jobs: [{ id: 1, title: "Backend Engineer" }] }));
    await expect(fetchJson(API, options)).resolves.toEqual({ jobs: [{ id: 1, title: "Backend Engineer" }] });
  });

  it("sends a GET with the User-Agent and asks for JSON", async () => {
    const fetchMock = mockFetch(json([]));
    await fetchJson(API, options);
    expect(fetchMock).toHaveBeenCalledWith(
      API,
      expect.objectContaining({
        method: "GET",
        headers: { "User-Agent": "JobRadarDK/test", Accept: "application/json" },
        body: undefined,
      }),
    );
  });

  it("sends a POST with a JSON body", async () => {
    const fetchMock = mockFetch(json({ total: 0, jobPostings: [] }));
    await fetchJson("https://example.wd3.myworkdayjobs.com/wday/cxs/example/External/jobs", {
      ...options,
      method: "POST",
      body: { limit: 20, offset: 0, searchText: "developer" },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", Accept: "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ limit: 20, offset: 0, searchText: "developer" });
  });

  it("explains a response that is not JSON, without retrying", async () => {
    const fetchMock = mockFetch(new Response("<html><body>Maintenance</body></html>"));
    await expect(fetchJson(API, options)).rejects.toThrow(
      `GET ${API} did not return valid JSON (starts with: "<html><body>Maintenance</body></html>")`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once after a 5xx, like fetchText", async () => {
    const fetchMock = mockFetch(json({ error: "down" }, 503), json({ ok: true }));
    await expect(fetchJson(API, options)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx, and names the method in the error", async () => {
    const fetchMock = mockFetch(json({}, 404));
    await expect(fetchJson(API, { ...options, method: "POST", body: {} })).rejects.toThrow(
      `POST ${API} failed with HTTP 404`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("createHttpClient", () => {
  it("gives adapters text and json helpers that share the same settings", async () => {
    const fetchMock = mockFetch(new Response("<rss/>"), json({ a: 1 }));
    const http = createHttpClient(options);
    await expect(http.text(URL)).resolves.toBe("<rss/>");
    await expect(http.json(API, { method: "POST", body: { q: 1 } })).resolves.toEqual({ a: 1 });
    const userAgents = fetchMock.mock.calls.map(([, init]) => (init as RequestInit & { headers: Record<string, string> }).headers["User-Agent"]);
    expect(userAgents).toEqual(["JobRadarDK/test", "JobRadarDK/test"]);
  });
});
