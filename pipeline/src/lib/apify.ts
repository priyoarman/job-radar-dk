import { HttpError } from "./http";

export type RunActor = (actor: string, input: unknown) => Promise<unknown[]>;

export type ApifyOptions = {
  token: string;
  maxChargeUsd: number;
  timeoutSecs: number;
};

export function runUrl(actor: string, options: Pick<ApifyOptions, "maxChargeUsd" | "timeoutSecs">): string {
  const params = new URLSearchParams({
    timeout: String(options.timeoutSecs),
    maxTotalChargeUsd: String(options.maxChargeUsd),
  });
  return `https://api.apify.com/v2/acts/${actor.replace("/", "~")}/run-sync-get-dataset-items?${params}`;
}

export function createApifyRunner(options: ApifyOptions, fetchImpl: typeof fetch = fetch): RunActor {
  return async (actor, input) => {
    const url = runUrl(actor, options);
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((options.timeoutSecs + 30) * 1000),
    });
    if (!response.ok) throw new HttpError(url, response.status, "POST");
    const items: unknown = await response.json();
    if (!Array.isArray(items)) throw new Error(`Apify actor ${actor} did not return a list of items`);
    return items;
  };
}
