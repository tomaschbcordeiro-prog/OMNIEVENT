import { ensureFresh, providerStatuses, dataSummary } from "@/lib/store";
import { FX_SOURCE } from "@/lib/currency";
import { handler, ok } from "@/lib/api";
import { getStates, snapshotIndex } from "@/lib/shared-cache";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

export const dynamic = "force-dynamic";

/** GET /api/providers — data sources, configuration state and last sync runs (no secrets). */
export const GET = handler(async () => {
  await ensureFresh();
  // When each source's shared snapshot was saved and how many events it holds.
  const shared = await snapshotIndex().catch(() => ({}));
  // This instance may not be the one that ran a source: fall back to the last run any instance
  // shared, and show where long crawls stand.
  const statuses = providerStatuses();
  const runs = await getStates<Record<string, unknown>>(statuses.map((p) => `run:${p.id}`));
  const crawlIds = ["ticketmaster", "seatgeek", "localist", "livewhale"];
  const crawls = await getStates<{ queue?: unknown[] } | number>(crawlIds.flatMap((id) => [`${id}:crawl`, `${id}:complete`]));
  const crawl = Object.fromEntries(
    crawlIds.map((id, i) => {
      const c = crawls[i * 2] as { queue?: unknown[] } | undefined;
      const done = crawls[i * 2 + 1] as number | undefined;
      return [id, { left: c?.queue?.length ?? 0, lastComplete: done ? new Date(done).toISOString() : null }];
    }),
  );
  const providers = statuses.map((p, i) => ({ ...p, lastRun: p.lastRun ?? runs[i], lastRealRun: runs[i] }));
  return ok({ providers, data: dataSummary(), shared, crawl, fx: FX_SOURCE, auth: { configured: false, mode: "local-demo" } });
});
