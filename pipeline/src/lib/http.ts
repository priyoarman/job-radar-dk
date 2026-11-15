export type HttpMethod = "GET" | "POST";

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly method: HttpMethod = "GET",
  ) {
    super(`${method} ${url} failed with HTTP ${status}`);
    this.name = "HttpError";
  }
}

export type FetchOptions = {
  userAgent: string;
  timeoutMs?: number;
  retryDelayMs?: number;
};

export type FetchTextOptions = FetchOptions;

export type JsonRequest = { method?: HttpMethod; body?: unknown };

export type HttpClient = {
  text(url: string): Promise<string>;
  json(url: string, request?: JsonRequest): Promise<unknown>;
};

type RequestSpec = { method: HttpMethod; headers: Record<string, string>; body?: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestOnce(url: string, spec: RequestSpec, timeoutMs: number): Promise<string> {
  const response = await fetch(url, {
    method: spec.method,
    headers: spec.headers,
    body: spec.body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new HttpError(url, response.status, spec.method);
  return response.text();
}

function isRetryable(error: unknown): boolean {
  return !(error instanceof HttpError) || error.status >= 500;
}

async function request(url: string, spec: RequestSpec, options: FetchOptions): Promise<string> {
  const { timeoutMs = 15_000, retryDelayMs = 2_000 } = options;
  try {
    return await requestOnce(url, spec, timeoutMs);
  } catch (error) {
    if (!isRetryable(error)) throw error;
    await sleep(retryDelayMs);
    return requestOnce(url, spec, timeoutMs);
  }
}

export function fetchText(url: string, options: FetchTextOptions): Promise<string> {
  return request(url, { method: "GET", headers: { "User-Agent": options.userAgent } }, options);
}

export async function fetchJson(url: string, options: FetchOptions & JsonRequest): Promise<unknown> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { "User-Agent": options.userAgent, Accept: "application/json" };
  const spec: RequestSpec = { method, headers };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    spec.body = JSON.stringify(options.body);
  }

  const text = await request(url, spec, options);
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.slice(0, 80).replace(/\s+/g, " ");
    throw new Error(`${method} ${url} did not return valid JSON (starts with: ${JSON.stringify(preview)})`);
  }
}

export function createHttpClient(options: FetchOptions): HttpClient {
  return {
    text: (url) => fetchText(url, options),
    json: (url, request = {}) => fetchJson(url, { ...options, ...request }),
  };
}
