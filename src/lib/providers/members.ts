import { loadAllUserEvents, toBatch, PROVIDER_ID } from "../user-events";
import type { ProviderAdapter } from "./types";

/** Events listed on OMNIEVENT by its members (see src/lib/user-events.ts). */
export const membersProvider: ProviderAdapter = {
  id: PROVIDER_ID,
  name: "Listed by members",
  isDemo: false,
  coverage: "Events that OMNIEVENT members list themselves, anywhere in the world.",
  isConfigured: () => true,
  selfShared: true,
  // A new listing shows on every server within a minute; the check is one tiny read.
  refreshIntervalMs: 60000,
  async sync() {
    const batch = toBatch(await loadAllUserEvents());
    return { batch, run: { finishedAt: new Date().toISOString(), imported: batch.events.length, updated: 0, failures: 0, rateLimited: false, ok: true } };
  },
};
