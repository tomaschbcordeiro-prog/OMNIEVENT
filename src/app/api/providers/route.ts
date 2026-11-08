import { ensureFresh, providerStatuses, dataSummary, hydrateInfo, batchSizes, packTrial } from "@/lib/store";
import { loadTimings } from "@/lib/shared-cache";
import { FX_SOURCE } from "@/lib/currency";
import { handler, ok, redactSecrets } from "@/lib/api";
import { getStates, snapshotIndex } from "@/lib/shared-cache";
import { storageStatus } from "@/lib/community/kv";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

export const dynamic = "force-dynamic";

/** GET /api/providers — data sources, configuration state and last sync runs (no secrets). */
export const GET = handler(async (req: Request) => {
  await ensureFresh();
  const sizes = new URL(req.url).searchParams.get("sizes");
  if (sizes && /^[a-z0-9-]{1,40}$/.test(sizes)) return ok({ sizes: batchSizes(sizes) ?? null });
  const pack = new URL(req.url).searchParams.get("pack");
  if (pack === "ticketmaster" || pack === "seatgeek") return ok({ pack: (await packTrial(pack)) ?? null });
  // When each source's shared snapshot was saved and how many events it holds.
  const shared = await snapshotIndex(providerStatuses().map((p) => p.id)).catch(() => ({}));
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
  // What Ticketmaster says it lists per country, to compare with what we hold.
  const [tmTotals, tmStarted] = await getStates<unknown>(["ticketmaster:totals", "ticketmaster:started"]);
  Object.assign(crawl.ticketmaster, { ...(tmTotals ? { listed: tmTotals } : {}), ...(tmStarted ? { started: tmStarted } : {}) });
  const providers = statuses.map((p, i) => ({ ...p, lastRun: p.lastRun ?? runs[i], lastRealRun: runs[i] }));
  // Errors from sources are shown as they came: anything shaped like a key is hidden first.
  // How this server is doing (how long it has run, how much memory it holds).
  const mem = process.memoryUsage();
  const server = { uptimeSec: Math.round(process.uptime()), rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576), hydrate: { ...hydrateInfo, loaded: hydrateInfo.loaded.slice(-40), failed: hydrateInfo.failed.slice(-10), timings: loadTimings } };
  const body = { providers, data: dataSummary(), server, storage: await storageStatus(), shared, crawl, fx: FX_SOURCE, auth: { configured: false, mode: "local-demo" } };
  return ok(JSON.parse(redactSecrets(JSON.stringify(body))));
});
