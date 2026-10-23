import type { OmniEvent, Participant, TicketOffer, Venue, SyncRun } from "../types";

/**
 * Every data source implements this interface. Provider-specific code never
 * leaks into UI components — the UI only sees the normalised domain model.
 */
export interface ProviderBatch {
  events: OmniEvent[];
  venues: Venue[];
  participants: Participant[];
  offers: TicketOffer[];
}

export interface SyncContext {
  /** Cap on records per run, to respect rate limits and quotas. */
  maxEvents: number;
  signal?: AbortSignal;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface ProviderAdapter {
  id: string;
  name: string;
  isDemo: boolean;
  /** Human-readable coverage statement shown in the UI. */
  coverage: string;
  attribution?: string;
  /** True when required credentials are present. */
  isConfigured(): boolean;
  /** Full or incremental fetch, normalised. Must handle pagination & rate limits internally. */
  sync(ctx: SyncContext): Promise<{ batch: ProviderBatch; run: Omit<SyncRun, "provider" | "runId" | "startedAt"> }>;
  /** Optional live refresh of a single event (detail + offers). */
  fetchEvent?(externalId: string): Promise<ProviderBatch | null>;
  /** How often the store should re-sync this provider. */
  refreshIntervalMs: number;
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number,
    public rateLimited = false,
  ) {
    super(`[${provider}] ${message}`);
  }
}
