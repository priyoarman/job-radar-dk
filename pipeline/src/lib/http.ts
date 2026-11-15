export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`GET ${url} failed with HTTP ${status}`);
    this.name = "HttpError";
  }
}

export type FetchTextOptions = {
  userAgent: string;
  timeoutMs?: number;
  retryDelayMs?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOnce(url: string, userAgent: string, timeoutMs: number): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new HttpError(url, response.status);
  return response.text();
}

function isRetryable(error: unknown): boolean {
  return !(error instanceof HttpError) || error.status >= 500;
}

export async function fetchText(url: string, options: FetchTextOptions): Promise<string> {
  const { userAgent, timeoutMs = 15_000, retryDelayMs = 2_000 } = options;
  try {
    return await fetchOnce(url, userAgent, timeoutMs);
  } catch (error) {
    if (!isRetryable(error)) throw error;
    await sleep(retryDelayMs);
    return fetchOnce(url, userAgent, timeoutMs);
  }
}
