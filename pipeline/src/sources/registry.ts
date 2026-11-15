import type { SourceType } from "@jobradar/db";
import { teamtailorAdapter } from "./teamtailor";
import type { SourceAdapter } from "./types";

export const adapters: Partial<Record<SourceType, SourceAdapter<unknown>>> = {
  TEAMTAILOR: teamtailorAdapter,
};

export function getAdapter(source: SourceType): SourceAdapter<unknown> {
  const adapter = adapters[source];
  if (!adapter) throw new Error(`No adapter for source "${source}" yet`);
  return adapter;
}
