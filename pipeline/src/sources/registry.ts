import type { SourceType } from "@jobradar/db";
import { ashbyAdapter } from "./ashby";
import { greenhouseAdapter } from "./greenhouse";
import { leverAdapter } from "./lever";
import { recruiteeAdapter } from "./recruitee";
import { successFactorsAdapter } from "./successfactors";
import { teamtailorAdapter } from "./teamtailor";
import { workableAdapter } from "./workable";
import { workdayAdapter } from "./workday";
import type { SourceAdapter } from "./types";

export const adapters: Partial<Record<SourceType, SourceAdapter<unknown>>> = {
  TEAMTAILOR: teamtailorAdapter,
  GREENHOUSE: greenhouseAdapter,
  LEVER: leverAdapter,
  ASHBY: ashbyAdapter,
  RECRUITEE: recruiteeAdapter,
  WORKABLE: workableAdapter,
  WORKDAY: workdayAdapter,
  SUCCESSFACTORS: successFactorsAdapter,
};

export function getAdapter(source: SourceType): SourceAdapter<unknown> {
  const adapter = adapters[source];
  if (!adapter) throw new Error(`No adapter for source "${source}" yet`);
  return adapter;
}
