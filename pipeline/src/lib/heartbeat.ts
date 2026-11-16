import type { RunStatus } from "@jobradar/db";
import { errorMessage } from "./errors";
import { log } from "./logger";

export const HEARTBEAT_TIMEOUT_MS = 10_000;

export function heartbeatUrl(baseUrl: string, status: RunStatus): string {
  const base = baseUrl.replace(/\/+$/, "");
  return status === "FAILED" ? `${base}/fail` : base;
}

export async function sendHeartbeat(
  baseUrl: string | undefined,
  status: RunStatus,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  if (!baseUrl) return;
  try {
    const response = await fetchFn(heartbeatUrl(baseUrl, status), { signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS) });
    if (!response.ok) log.warn("heartbeat.failed", { httpStatus: response.status });
  } catch (error) {
    log.warn("heartbeat.failed", { error: errorMessage(error) });
  }
}
