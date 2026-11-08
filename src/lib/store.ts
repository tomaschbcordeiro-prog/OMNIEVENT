import { inPrerender, outsideRender } from "./outside-render";
import "server-only";
import { after } from "next/server";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { internBatch } from "./intern";
import { acquireLock, cleanupSnapshots, loadSnapshot, releaseLock, saveSnapshot, setState, sharedEnabled, sharedStoreUp, snapshotIndex } from "./shared-cache";
import { activeProviders, ALL_PROVIDERS } from "./providers/registry";
import type { ProviderAdapter, ProviderBatch } from "./providers/types";
import { CATEGORIES, descendantsOf, getCategory } from "./categories";
import { convert } from "./currency";
import { getDestination, CITIES } from "./destinations";
import { haversineKm, gridKey, latLngToVec3, cellWidthFactor, gridCell, EARTH_RADIUS_KM } from "./geo";
import { localDateKey } from "./format";
import { windowIntervals, overlaps, todayIn, isValidTimeZone, parseHM, tzOffsetMs } from "./time";
import { log } from "./log";
import type { MixCandidate } from "./mixtape/plan";
import type {
  Cluster,
  EventCard,
  EventView,
  OmniEvent,
  Paged,
  Participant,
  ProviderStatus,
  SearchFilters,
  SyncRun,
  TicketOffer,
  Venue,
} from "./types";

/**
 * In-process event store.
 *
 * Production path: the same interface backed by PostgreSQL/PostGIS (schema in
 * db/migrations). The in-memory implementation keeps the app runnable with zero
 * infrastructure and is fine for one long-running Node server; on serverless,
 * each instance warms its own copy and the cron job keeps providers fresh.
 */
interface StoreState {
  events: Map<string, OmniEvent>;
  bySlug: Map<string, string>;
  venues: Map<string, Venue>;
  venuesBySlug: Map<string, string>;
  /** Cards by 1° map cell, and by city: a city's searches only look at what's near it. */
  grid?: Map<string, EventCard[]>;
  byCity?: Map<string, EventCard[]>;
  /** Cards by their venue's country code (upper case): a country's or continent's searches look only there. */
  byCountry?: Map<string, EventCard[]>;
  /** Cards by venue slug and by performer slug: a venue's or a performer's dates without looking through every card. */
  byVenue?: Map<string, EventCard[]>;
  byPerson?: Map<string, EventCard[]>;
  /** Event counts per city, worked out once per rebuild. */
  cityStatsCache?: Record<string, { total: number; groups: Record<string, number> }>;
  participants: Map<string, Participant>;
  participantsBySlug: Map<string, string>;
  offers: Map<string, TicketOffer[]>;
  offersById: Map<string, TicketOffer>;
  cards: Map<string, EventCard>;
  providerData: Map<string, ProviderBatch>;
  runs: Map<string, SyncRun>;
  lastSync: Map<string, number>;
  syncing: Map<string, Promise<void>>;
  /** event id → canonical event id when merged as a duplicate. */
  aliases: Map<string, string>;
  /** Until when requests may wait for this server's first data. */
  firstLoadDeadline?: number;
  /** When this instance last looked for newer shared snapshots, and the one in flight. */
  sharedCheckedAt?: number;
  hydrating?: Promise<void>;
  /** The shared snapshots last seen, and the sources whose snapshot couldn't be loaded. */
  snapIndex?: Record<string, { at: number }>;
  snapFailed?: Set<string>;
}

const g = globalThis as unknown as { __omniStore?: StoreState };
const state: StoreState =
  g.__omniStore ??
  (g.__omniStore = {
    events: new Map(),
    bySlug: new Map(),
    venues: new Map(),
    venuesBySlug: new Map(),
    participants: new Map(),
    participantsBySlug: new Map(),
    offers: new Map(),
    offersById: new Map(),
    cards: new Map(),
    providerData: new Map(),
    runs: new Map(),
    lastSync: new Map(),
    syncing: new Map(),
    aliases: new Map(),
  });

// ------------------------------------------------------------------ sync

/** Sources with a daily request quota: only ever read by one instance at a time. */
const QUOTA_SOURCES = new Set(["ticketmaster", "seatgeek", "skiddle"]);
/** Catalogues big or slow enough that reading them takes minutes of server time. */
const HEAVY_SOURCES = new Set(["openagenda", "localist", "livewhale", "helsinki", "espoo", "berlin", "wikidata"]);
/**
 * The most events one source may hold; the soonest are kept. The two worldwide ticket
 * catalogues grow as their crawls reach further ahead, and every server holds the whole
 * catalogue in 2 GB of memory.
 */
const SOURCE_MAX_EVENTS = Number(process.env.SOURCE_MAX_EVENTS ?? 65000);
/** Above this much memory in use, big sources wait before reading more (they come back later). */
const MEMORY_SOFT_LIMIT_MB = Number(process.env.MEMORY_SOFT_LIMIT_MB ?? 1700);

/** A source over its limit keeps its soonest events, and only the venues, people and tickets they use. */
export function trimBatch(batch: ProviderBatch, max = SOURCE_MAX_EVENTS): ProviderBatch {
  if (!(max > 0) || batch.events.length <= max) return batch;
  const when = (e: OmniEvent) => {
    const t = Date.parse(e.start);
    return Number.isFinite(t) ? t : Infinity;
  };
  const events = batch.events
    .map((e) => [when(e), e] as const)
    .sort((x, y) => x[0] - y[0])
    .slice(0, max)
    .map(([, e]) => e);
  const ids = new Set(events.map((e) => e.id));
  const venues = new Set(events.map((e) => e.venueId));
  const people = new Set(events.flatMap((e) => e.participants.map((x) => x.participantId)));
  return {
    ...batch,
    events,
    venues: batch.venues.filter((v) => venues.has(v.id)),
    participants: batch.participants.filter((x) => people.has(x.id)),
    offers: batch.offers.filter((o) => ids.has(o.eventId)),
  };
}

function memoryMb(): number {
  try {
    return process.memoryUsage.rss() / 1048576;
  } catch {
    return 0;
  }
}

/**
 * What this server really holds, in MB: its memory after a full garbage collection, not
 * counting space the process keeps but isn't using. The process's total (RSS) rarely shrinks
 * once grown, so a server that went past the soft limit while loading looked full for good
 * and never refreshed its big sources again. Asking for a collection takes a moment, so this
 * is only asked when the total is high. Falls back to the total if it can't be asked for.
 */
let collect: (() => void) | null | undefined;
/** The last such check (for the status page). */
export const memoryCheck: { at?: string; settledMb?: number; rssMb?: number } = {};
function settledMemoryMb(): number {
  try {
    if (collect === undefined) {
      setFlagsFromString("--expose-gc");
      collect = runInNewContext("gc") as () => void;
    }
    if (!collect) return memoryMb();
    const rss = memoryMb();
    collect();
    const m = process.memoryUsage();
    const settled = (m.heapUsed + m.external) / 1048576;
    Object.assign(memoryCheck, { at: new Date().toISOString(), settledMb: Math.round(settled), rssMb: Math.round(rss) });
    return settled;
  } catch {
    collect = null;
    return memoryMb();
  }
}
/** In use after a collection, above which the big catalogues wait (they need a few hundred MB more while read). */
const SETTLED_LIMIT_MB = Number(process.env.SETTLED_MEMORY_LIMIT_MB ?? 1250);

/** When this instance last uploaded each source's snapshot. */
const savedAt = new Map<string, number>();
/** How recent each source's data on this instance is (its own sync or a loaded snapshot). */
const dataAt = new Map<string, number>();

/** How old a source's data on an instance may get before a newer shared copy is downloaded. */
const SNAPSHOT_REFRESH_MS = Number(process.env.SNAPSHOT_REFRESH_HOURS ?? 3) * 3600000;

/** How long the first requests a server answers may wait for its data. */
// A new server answers within a few seconds with what it has; the rest keeps loading (the
// index is rebuilt in slices, so the server stays responsive). On Vercel the shared copies
// take ten to fifteen seconds in all: the first visitors wait six, see most of the catalogue,
// and the page completes itself when the rest is in (see StillLoading).
const FIRST_LOAD_WAIT = Number(process.env.FIRST_LOAD_WAIT_MS ?? (process.env.VERCEL === "1" ? 6000 : 4000));

const SYNC_SLOTS = Number(process.env.SYNC_CONCURRENCY ?? 8);
const HEAVY_SLOTS = 2;
const slotsBusy = { all: 0, heavy: 0 };
const slotQueue: { heavy: boolean; go: () => void }[] = [];
function pumpSlots() {
  for (let i = 0; i < slotQueue.length; i++) {
    const q = slotQueue[i];
    if (slotsBusy.all >= SYNC_SLOTS || (q.heavy && slotsBusy.heavy >= HEAVY_SLOTS)) continue;
    slotQueue.splice(i--, 1);
    slotsBusy.all++;
    if (q.heavy) slotsBusy.heavy++;
    q.go();
  }
}
/** Waits for a turn to read a source; returns the function that gives the turn back. */
async function syncSlot(heavy: boolean): Promise<() => void> {
  await new Promise<void>((go) => {
    slotQueue.push({ heavy, go });
    pumpSlots();
  });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    slotsBusy.all--;
    if (heavy) slotsBusy.heavy--;
    pumpSlots();
  };
}

async function syncProvider(p: ProviderAdapter): Promise<void> {
  const existing = state.syncing.get(p.id);
  if (existing) return existing;
  const runId = `${p.id}-${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();
  // A source that already lives in the shared storage is read directly by every server.
  const shared = sharedEnabled && !p.isDemo && !p.selfShared;
  // Outside any page being rendered: see outsideRender.
  const job = outsideRender(async () => {
    // One instance reads a source at a time; the others pick up its snapshot. An instance
    // with nothing at all from a source reads it anyway, except sources with a daily quota.
    let locked = false;
    // Without the shared storage, instances can't share one read of a source: each would spend
    // a daily quota, or minutes of server time on a big catalogue, on its own. Those wait for
    // the storage instead; the smaller sources still load.
    // Close to the server's memory limit, the big catalogues wait (they'd add more than there's room for).
    if ((QUOTA_SOURCES.has(p.id) || HEAVY_SOURCES.has(p.id)) && state.providerData.has(p.id) && memoryMb() > MEMORY_SOFT_LIMIT_MB && settledMemoryMb() > SETTLED_LIMIT_MB) {
      log("info", "sync deferred: memory", { provider: p.id, rssMb: Math.round(memoryMb()) });
      state.lastSync.set(p.id, Date.now() - p.refreshIntervalMs + 30 * 60000);
      state.syncing.delete(p.id);
      return;
    }
    if (shared && (QUOTA_SOURCES.has(p.id) || HEAVY_SOURCES.has(p.id)) && !sharedStoreUp()) {
      state.lastSync.set(p.id, Date.now() - p.refreshIntervalMs + 10 * 60000);
      state.syncing.delete(p.id);
      return;
    }
    if (shared) {
      // Big catalogues take minutes (and may wait their turn first): their lock lasts longer.
      locked = await acquireLock(`sync:${p.id}`, HEAVY_SOURCES.has(p.id) ? 900 : 330);
      if (!locked && (QUOTA_SOURCES.has(p.id) || state.providerData.has(p.id))) {
        state.lastSync.set(p.id, Date.now() - p.refreshIntervalMs + 10 * 60000);
        state.syncing.delete(p.id);
        return;
      }
    }
    // A few sources at a time (one big catalogue at a time): reading them all at once on a new
    // server held more in memory than it has.
    const release = await syncSlot(HEAVY_SOURCES.has(p.id));
    try {
      let lastPublish = 0;
      // What we had before this run: partial results published during it don't count as "updated".
      const before = state.providerData.get(p.id);
      const synced = await p.sync({
        maxEvents: Number(process.env.SYNC_MAX_EVENTS ?? 25000),
        log: (msg, extra) => log("info", msg, { provider: p.id, runId, ...extra }),
        // Partial results join what we already had; published at most every 20 seconds.
        onProgress: (partial) => {
          if (Date.now() - lastPublish < 20000) return;
          lastPublish = Date.now();
          const prev = state.providerData.get(p.id);
          const merged: ProviderBatch = { events: [...partial.events], venues: [...partial.venues], participants: [...partial.participants], offers: [...partial.offers] };
          if (prev) mergeMissing(merged, prev);
          state.providerData.set(p.id, trimBatch(merged));
          // In slices: a big catalogue's crawl publishes every 20 s, and a full rebuild at once
          // would stop the server answering for seconds each time.
          void rebuildIndexesSliced();
        },
      });
      let batch = synced.batch;
      const run = synced.run;
      const fresh = batch.events.length;
      const prev = state.providerData.get(p.id);
      const prevIds = new Set(before?.events.map((e) => e.id));
      // A run cut short (quota, network), or one that covered part of a long crawl, keeps
      // what we already had instead of dropping it.
      if (prev && (run.failures > 0 || run.partial)) mergeMissing(batch, prev);
      // Part of a crawl also joins the shared snapshot, which may hold earlier parts read by
      // other instances.
      if (shared && run.partial) {
        const meta = (await snapshotIndex([p.id]).catch(() => ({}) as Record<string, never>))[p.id];
        if (meta && meta.at > (dataAt.get(p.id) ?? 0)) {
          const snap = await loadSnapshot(p.id, meta).catch(() => undefined);
          if (snap) mergeMissing(batch, snap);
        }
      }
      const trimmed = trimBatch(batch);
      if (trimmed !== batch) {
        log("info", "source trimmed to its limit", { provider: p.id, events: batch.events.length, kept: trimmed.events.length });
        batch = trimmed;
      }
      // One copy of each repeated text (see internBatch).
      internBatch(batch);
      const updated = batch.events.filter((e) => prevIds.has(e.id)).length;
      // The same data as before (the members' listings re-read every minute, mostly unchanged):
      // nothing to rebuild.
      const unchanged = !!before && batchSig(before) === batchSig(batch);
      state.providerData.set(p.id, batch);
      dataAt.set(p.id, Date.now());
      // A source that refused us with nothing to show is retried in 30 minutes, not after
      // its full refresh interval (and not every few minutes, which would waste quota).
      state.lastSync.set(p.id, run.rateLimited && !batch.events.length ? Date.now() - p.refreshIntervalMs + 30 * 60000 : Date.now());
      state.runs.set(p.id, { ...run, provider: p.id, runId, startedAt, updated, imported: batch.events.length - updated });
      // Every instance can then report how the last real run went, wherever it ran.
      // (A crawl's idle turn — nothing read, nothing wrong — doesn't replace the last real one.)
      if (shared && (fresh || run.error || !run.partial)) void setState(`run:${p.id}`, { ...state.runs.get(p.id), fresh }, 7 * 86400).catch(() => {});
      // Indexed in slices, the server answering meanwhile; sources that finish close together
      // share one rebuild (each full rebuild of a big catalogue costs seconds).
      if (!unchanged) await rebuildIndexesSliced();
      log("info", "provider sync complete", { provider: p.id, runId, events: batch.events.length, failures: run.failures });
      // Shared only when this run brought something (a run that found nothing new doesn't
      // re-upload), and during a long crawl at most every 90 minutes to spare bandwidth.
      const lastSave = savedAt.get(p.id) ?? 0;
      if (shared && fresh && (!run.partial || Date.now() - lastSave > 90 * 60000 || !(run.error ?? "").includes("left"))) {
        savedAt.set(p.id, Date.now());
        const t0 = Date.now();
        // Left as "started" if the server stops mid-save (out of memory, for one).
        await setState(`save:${p.id}`, { at: new Date().toISOString(), started: true, events: batch.events.length, rssMb: Math.round(memoryMb()) }, 7 * 86400);
        await saveSnapshot(p.id, batch).then(
          // How the last save of each source went, wherever it ran (for the status page).
          () => setState(`save:${p.id}`, { at: new Date().toISOString(), ok: true, ms: Date.now() - t0, events: batch.events.length }, 7 * 86400),
          (err) => {
          void setState(`save:${p.id}`, { at: new Date().toISOString(), ok: false, ms: Date.now() - t0, err: String(err).slice(0, 200) }, 7 * 86400);
          log("error", "snapshot save failed", { provider: p.id, err: String(err) });
          const r = state.runs.get(p.id);
          if (r) state.runs.set(p.id, { ...r, error: [r.error, `not shared with other servers (${String(err).slice(0, 120)})`].filter(Boolean).join("; ") });
        });
      }
    } catch (err) {
      state.runs.set(p.id, { provider: p.id, runId, startedAt, finishedAt: new Date().toISOString(), imported: 0, updated: 0, failures: 1, rateLimited: false, ok: false, error: String(err) });
      if (shared) void setState(`run:${p.id}`, state.runs.get(p.id), 7 * 86400).catch(() => {});
      // Back off before retrying a failing provider.
      state.lastSync.set(p.id, Date.now() - p.refreshIntervalMs + 5 * 60000);
      log("error", "provider sync failed", { provider: p.id, runId, err: String(err) });
    } finally {
      release();
      state.syncing.delete(p.id);
      if (locked) await releaseLock(`sync:${p.id}`);
    }
  });
  state.syncing.set(p.id, job);
  return job;
}

/** A fingerprint of a batch: its events (ids, times, status, titles) and the counts of the rest. */
const sigCache = new WeakMap<ProviderBatch, string>();
function batchSig(b: ProviderBatch): string {
  let sig = sigCache.get(b);
  if (sig) return sig;
  let h = 2166136261;
  const mix = (str: string) => {
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  };
  for (const e of b.events) mix(`${e.id}|${e.start}|${e.end ?? ""}|${e.status}|${e.title}|${e.imageUrl ?? ""};`);
  for (const o of b.offers) mix(`${o.id}|${o.basePrice ?? ""}|${o.availability};`);
  sig = `${b.events.length}/${b.venues.length}/${b.participants.length}/${b.offers.length}/${(h >>> 0).toString(36)}`;
  sigCache.set(b, sig);
  return sig;
}

function mergeMissing(batch: ProviderBatch, prev: ProviderBatch) {
  const have = <T extends { id: string }>(list: T[]) => new Set(list.map((x) => x.id));
  const ev = have(batch.events);
  const now = Date.now();
  // Kept while still to come or on: one with no end counts as on for six hours after it starts,
  // so a show that began this morning doesn't vanish while its source is read again.
  for (const e of prev.events) if (!ev.has(e.id) && Date.parse(e.schedule?.at(-1) ?? e.end ?? e.start) + (e.end || e.schedule?.length ? 0 : 6 * 3600000) > now) batch.events.push(e);
  const keep = have(batch.events);
  const vn = have(batch.venues);
  for (const v of prev.venues) if (!vn.has(v.id)) batch.venues.push(v);
  const pp = have(batch.participants);
  for (const x of prev.participants) if (!pp.has(x.id)) batch.participants.push(x);
  const of = have(batch.offers);
  for (const o of prev.offers) if (!of.has(o.id) && keep.has(o.eventId)) batch.offers.push(o);
}

/**
 * Ensures data is loaded and refreshes stale providers. The first call awaits the
 * initial load; later refreshes run in the background (stale-while-revalidate).
 */
/**
 * Loads snapshots other instances saved that are newer than what this instance has.
 * Checked when an instance starts and then every five minutes (one small request).
 */
/** How the last load of shared copies went on this server (for the status page). */
export const hydrateInfo: { runs: number; startedAt?: number; indexMs?: number; indexed?: number; loaded: string[]; failed: string[]; doneMs?: number; rebuilds: number; /** Sources being loaded now, and since when (ms after the start). */ loading: Record<string, number>; rebuildErrors: string[] } = { runs: 0, loaded: [], failed: [], rebuilds: 0, loading: {}, rebuildErrors: [] };
async function hydrate(providers: ProviderAdapter[]): Promise<void> {
  let index: Awaited<ReturnType<typeof snapshotIndex>>;
  const t0 = Date.now();
  hydrateInfo.runs++;
  hydrateInfo.startedAt = t0;
  try {
    index = await snapshotIndex(providers.map((p) => p.id));
    state.snapIndex = index;
    hydrateInfo.indexMs = Date.now() - t0;
    hydrateInfo.indexed = Object.keys(index).length;
  } catch (err) {
    log("error", "snapshot index failed", { err: String(err) });
    hydrateInfo.failed.push(`index: ${String(err).slice(0, 80)}`);
    return;
  }
  let changed = false;
  // The index is rebuilt in slices while copies arrive (the server keeps answering meanwhile),
  // at most one pass every two seconds, and once more at the end if anything arrived after the
  // last pass began.
  let lastLoadAt = 0;
  let lastPassAt = 0;
  const pass = () => {
    lastPassAt = Date.now();
    hydrateInfo.rebuilds++;
    return rebuildIndexesSliced();
  };
  // Four sources at a time (each snapshot is unpacked in memory before it's kept), the
  // smallest first so most of the catalogue shows within the first seconds.
  const queue = [...providers].sort((a, b) => (index[a.id]?.events ?? 0) - (index[b.id]?.events ?? 0));
  const queueSize = queue.length;
  const rebuildsBefore = hydrateInfo.rebuilds;
  const loadedBefore = hydrateInfo.loaded.length;
  const loadOne = async (p: ProviderAdapter) => {
      const meta = index[p.id];
      // A source being read live here still takes its shared copy (merged with what the live
      // read has found so far): a big catalogue's live read takes minutes, and meanwhile the
      // server would show none, or only part, of its events.
      if (!meta || p.isDemo || p.selfShared || meta.at <= (dataAt.get(p.id) ?? 0)) return;
      // An instance that already holds a source re-downloads it at most every few hours:
      // big catalogues are tens of megabytes, and long crawls save new copies often, so
      // fetching each one on every instance used up the storage plan's transfer allowance.
      const have = dataAt.get(p.id);
      if (have !== undefined && state.providerData.has(p.id) && meta.at - have < SNAPSHOT_REFRESH_MS) return;
      const since = Date.now();
      hydrateInfo.loading[p.id] = since - t0;
      try {
        const loaded = await loadSnapshot(p.id, meta);
        if (!loaded) return;
        // A copy saved before the limit (or with a higher one) is trimmed as it arrives.
        let batch = trimBatch(loaded);
        const partial = state.syncing.has(p.id) ? state.providerData.get(p.id) : undefined;
        if (partial) {
          const merged: ProviderBatch = { events: [...partial.events], venues: [...partial.venues], participants: [...partial.participants], offers: [...partial.offers] };
          mergeMissing(merged, batch);
          batch = trimBatch(merged);
        }
        state.providerData.set(p.id, batch);
        dataAt.set(p.id, meta.at);
        state.lastSync.set(p.id, Math.max(meta.at, state.lastSync.get(p.id) ?? 0));
        // A new server shows the sources as they arrive.
        hydrateInfo.loaded.push(`${p.id}@${Math.round((Date.now() - t0) / 100) / 10}s`);
        lastLoadAt = Date.now();
        // While loading, few passes (each goes over everything loaded so far and competes with
        // the loading for the processor): one early so the first visitors see most of the
        // catalogue, one when most sources are in; the last one when everything is.
        const passes = hydrateInfo.rebuilds - rebuildsBefore;
        const loadedShare = (hydrateInfo.loaded.length - loadedBefore) / Math.max(1, queueSize);
        if (!sliced && ((passes === 0 && Date.now() - t0 >= 1500) || (passes === 1 && loadedShare >= 0.85))) void pass();
        if (!state.runs.has(p.id))
          state.runs.set(p.id, { provider: p.id, runId: `shared-${meta.ver}`, startedAt: new Date(meta.at).toISOString(), finishedAt: new Date(meta.at).toISOString(), imported: batch.events.length, updated: 0, failures: 0, rateLimited: false, ok: true });
        changed = true;
      } catch (err) {
        hydrateInfo.failed.push(`${p.id}: ${String(err).slice(0, 80)}`);
        (state.snapFailed ??= new Set()).add(p.id);
        log("error", "snapshot load failed", { provider: p.id, err: String(err) });
      } finally {
        delete hydrateInfo.loading[p.id];
      }
  };
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) await loadOne(queue.shift()!);
    }),
  );
  if (changed) {
    while (sliced) await sliced;
    if (lastLoadAt >= lastPassAt) await pass();
  }
  hydrateInfo.doneMs = Date.now() - t0;
  // Then, in slices, what every search needs (words, dates, intervals), so the first searches
  // are quick; done after the loading, which it would otherwise slow down.
  warming = warmSearch().finally(() => (warming = undefined));
}

/**
 * On Vercel, a visitor's request may only keep reading for five minutes after it's answered:
 * too short for the biggest catalogues (Berlin, Espoo take over five). Those are read by the
 * scheduled tick, which may run for longer, and every server takes them from its snapshot.
 */
const heavyOnlyInTick = process.env.VERCEL === "1";

export async function ensureFresh(opts: { heavy?: boolean } = {}): Promise<void> {
  const heavyOk = !!opts.heavy || !heavyOnlyInTick;
  const providers = activeProviders();
  // A check stuck for over two minutes is abandoned so the next one can run.
  if (state.hydrating && Date.now() - (state.sharedCheckedAt ?? 0) > 120000) state.hydrating = undefined;
  if (sharedEnabled && !state.hydrating && Date.now() - (state.sharedCheckedAt ?? 0) > 5 * 60000) {
    const first = state.sharedCheckedAt === undefined;
    state.sharedCheckedAt = Date.now();
    state.hydrating = outsideRender(() => hydrate(providers)).finally(() => (state.hydrating = undefined));
    // Old snapshot copies are cleared out (one instance, at most hourly).
    void outsideRender(() => cleanupSnapshots())
      .then((n) => n && log("info", "old snapshot chunks removed", { n }))
      .catch((err) => log("error", "snapshot cleanup failed", { err: String(err) }));
    // A new instance starts from the shared snapshots before deciding what to re-read, within
    // the same first-load deadline as everything else.
    if (first) {
      state.firstLoadDeadline ??= Date.now() + FIRST_LOAD_WAIT;
      await Promise.race([state.hydrating, new Promise((r) => setTimeout(r, Math.max(0, state.firstLoadDeadline! - Date.now())))]);
    }
  }
  // Drop data from providers that are no longer active (e.g. demo after a key is added).
  let dropped = false;
  for (const id of state.providerData.keys())
    if (!providers.find((p) => p.id === id)) {
      state.providerData.delete(id);
      dropped = true;
    }
  if (dropped) rebuildIndexes();

  const now = Date.now();
  // A page rendered for the cache (an event page) only takes what's loaded or shared: reading
  // sources from inside it would hold the page until they finish. Pages rendered for a visitor,
  // the API and the scheduled tick keep the sources fresh.
  if (inPrerender()) {
    if (state.hydrating && state.firstLoadDeadline) await Promise.race([state.hydrating, new Promise((r) => setTimeout(r, Math.max(0, state.firstLoadDeadline! - Date.now())))]);
    return;
  }
  const waits: Promise<void>[] = [];
  for (const p of providers) {
    const last = state.lastSync.get(p.id);
    if (!heavyOk && HEAVY_SOURCES.has(p.id) && sharedEnabled) {
      // Left to the tick; until its snapshot arrives, look again for one in ten minutes.
      if (last === undefined && !state.snapIndex?.[p.id]) state.lastSync.set(p.id, now - p.refreshIntervalMs + 10 * 60000);
      continue;
    }
    if (last === undefined) {
      // A recent shared snapshot is on its way (or loading): don't re-read the whole source.
      // While a new server loads its shared copies, even an older copy is loaded first: reading
      // sources live at the same time slowed the loading down to a minute; the live read follows
      // once the server is whole (the copy's date then makes it due).
      const meta = state.snapIndex?.[p.id];
      if (meta && (now - meta.at < p.refreshIntervalMs || state.hydrating) && !state.snapFailed?.has(p.id)) continue;
      waits.push(syncProvider(p));
    } else if (now - last > p.refreshIntervalMs) void syncProvider(p);
  }
  // A slow source must not hold the first page hostage: wait a bounded time, then serve
  // whatever has loaded while the rest keeps syncing in the background.
  // On serverless hosts an instance freezes once its response is sent; ask the platform to
  // keep it running until background syncs finish (bounded by the route's maxDuration).
  // The same for a new server loading its shared copies, and for index rebuilds under way:
  // without it, that work went on only while some request happened to be running (a quiet
  // server took up to two minutes to load what takes about thirty seconds).
  const running: Promise<unknown>[] = [...state.syncing.values()];
  if (state.hydrating) running.push(state.hydrating);
  if (sliced) running.push(sliced);
  if (warming) running.push(warming);
  if (running.length) {
    try {
      after(() => Promise.allSettled(running));
    } catch {
      // Not inside a request (tests, scripts): nothing to extend.
    }
  }
  if (waits.length) {
    // Only the first moments of a server's life wait: one deadline shared by every request,
    // so a source that takes minutes (a full catalogue crawl) never slows later pages.
    state.firstLoadDeadline ??= now + FIRST_LOAD_WAIT;
    const left = state.firstLoadDeadline - now;
    if (left > 0) await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, left))]);
  }
}

/**
 * Reads one source again now (after a member lists, changes or removes an event), waiting for
 * a read already under way to finish first so the new one sees the change.
 */
export async function refreshSource(id: string): Promise<void> {
  const p = activeProviders().find((x) => x.id === id);
  if (!p) return;
  await state.syncing.get(id)?.catch(() => {});
  await syncProvider(p);
}

/**
 * Waits (at most `ms`) for the sources still loading on this server: for a page about one
 * event, venue or performer that isn't here yet, before saying it doesn't exist.
 */
export async function waitForData(ms: number): Promise<void> {
  if (dataReady()) return;
  const pending = [...state.syncing.values(), ...(state.hydrating ? [state.hydrating] : [])];
  if (!pending.length) return;
  await Promise.race([Promise.allSettled(pending), new Promise((r) => setTimeout(r, ms))]);
}

/**
 * True once this server holds every active source's data (or has given up on one). Before
 * that, answers may be missing sources and mustn't be cached for other visitors.
 */
/**
 * Whether this server is loading anything right now (shared copies, or a source it has never
 * held): until it isn't, a missing event may just not be here yet.
 */
export function loadingNow(): boolean {
  if (state.hydrating) return true;
  // A source being read for the first time; one that failed before and is being retried isn't.
  for (const id of state.syncing.keys()) if (!state.providerData.has(id) && !state.runs.has(id)) return true;
  return false;
}

/**
 * Something a page needs (an event, a venue) that this server may still be loading: looked for
 * again every moment while it loads, up to `ms`, and returned as soon as it's in.
 */
export async function waitFor<T>(find: () => T | undefined, ms = 20000): Promise<T | undefined> {
  const until = Date.now() + ms;
  let found = find();
  while (found === undefined && loadingNow() && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 400));
    found = find();
  }
  return found;
}

/** How many events this server can show right now (cheap). */
export function eventCount(): number {
  return state.cards.size;
}

export function dataReady(): boolean {
  if (state.hydrating) return false;
  return activeProviders().every((p) => state.lastSync.has(p.id));
}

export async function forceSync(providerId?: string): Promise<SyncRun[]> {
  const providers = activeProviders().filter((p) => !providerId || p.id === providerId);
  await Promise.all(providers.map(syncProvider));
  return providers.map((p) => state.runs.get(p.id)!).filter(Boolean);
}

export function providerStatuses(): ProviderStatus[] {
  const active = new Set(activeProviders().map((p) => p.id));
  return ALL_PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    enabled: active.has(p.id),
    isDemo: p.isDemo,
    configured: p.isConfigured(),
    lastRun: state.runs.get(p.id),
    coverage: p.coverage,
    attribution: p.attribution,
  }));
}

// ------------------------------------------------------------------ indexing & dedupe

// Any value: a source that leaves out a name or title must not break every search.
const norm = (s: unknown) =>
  String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Ticket sellers sometimes give one show an "end" weeks or a year away (a pass's validity, a
// season's last date). A single show doesn't last days, so that end is dropped; runs the
// seller marks as such come in as multi-day events.
const SELLERS = new Set(["ticketmaster", "seatgeek", "skiddle"]);
function sane(e: OmniEvent): OmniEvent {
  if (e.eventType === "single" && e.end && SELLERS.has(e.provenance.provider) && Date.parse(e.end) - Date.parse(e.start) > DAY) return { ...e, end: undefined };
  return e;
}

// What a rebuild works out per record is kept with the source's own objects, which stay the
// same until that source is read again: rebuilding then mostly reuses (and every cache keyed
// on an event or card, such as its days or its search text, stays warm).
/** Keeps a worked-out value on a record without it showing up in copies ({...e}) or JSON. */
function keep<T extends object, V>(o: T, key: symbol, value: V): V {
  Object.defineProperty(o, key, { value, writable: true, configurable: true, enumerable: false });
  return value;
}
const TITLE = Symbol("title");
const COPY = Symbol("copy");
const CARD = Symbol("card");
type Memo = OmniEvent & { [TITLE]?: string; [COPY]?: OmniEvent; [CARD]?: { card: EventCard; venue: Venue | undefined; offers: TicketOffer[]; people: (Participant | undefined)[] } };
// Kept on the record itself under a symbol (unseen by JSON and by the rest of the code):
// cheaper to read and to collect than one more WeakMap entry per record.
const DEDUPE = Symbol("dedupe");
type DedupeKey = { v: Venue; t: string; startMs: number; key: string; day: string };
function titleOf(e: OmniEvent): string {
  let t = (e as Memo)[TITLE];
  if (t === undefined) t = keep(e, TITLE, norm(e.title));
  return t;
}
function canonicalCopy(e: OmniEvent): OmniEvent {
  let c = (e as Memo)[COPY];
  if (!c) {
    const s = sane(e);
    // Most records are already their own canonical copy: kept as they are, not copied (copying
    // a big catalogue's every record cost seconds on a new server, mostly in garbage collection).
    c = s === e && e.canonicalId === e.id ? e : { ...s, canonicalId: e.id };
    keep(e, COPY, c);
  }
  return c;
}
const offerCopies = new WeakMap<TicketOffer, TicketOffer>();
function offerCopy(o: TicketOffer, eventId: string): TicketOffer {
  // An offer for the event it was listed with needs no copy; one moved to the merged event does.
  if (o.eventId === eventId) return o;
  let c = offerCopies.get(o);
  if (!c || c.eventId !== eventId) offerCopies.set(o, (c = { ...o, eventId }));
  return c;
}
const NO_OFFERS: TicketOffer[] = [];
function cardFor(e: OmniEvent, venues: Map<string, Venue>, participants: Map<string, Participant>, offers: TicketOffer[]): EventCard {
  const venue = venues.get(e.venueId);
  const people = e.participants.map((ep) => participants.get(ep.participantId));
  const m = (e as Memo)[CARD];
  if (m && m.venue === venue && m.offers.length === offers.length && m.offers.every((o, i) => o === offers[i]) && m.people.every((p, i) => p === people[i]) && m.people.length === people.length) return m.card;
  const card = toCard(e, venues, participants, offers);
  keep(e, CARD, { card, venue, offers: [...offers], people });
  return card;
}

/** The cards of every country on a continent (as `matches` places a venue's country). */
function* inContinent(byCountry: Map<string, EventCard[]>, continent: string): Generator<EventCard> {
  for (const [cc, list] of byCountry) if (getDestination(cc.toLowerCase())?.continent === continent) yield* list;
}

/** A 1° map cell's key (longitudes wrapped to -180…179). */
const cellKey = (lat: number, lng: number) => `${lat}|${((((lng + 180) % 360) + 360) % 360) - 180}`;

/**
 * The cards a search could match: for a city, only those in the map cells within reach of it
 * (40 km) and those filed under it; otherwise every card. `matches` still decides.
 */
function candidates(f: SearchFilters): Iterable<EventCard> {
  // A country's or continent's: only its countries' cards (a continent page ran its searches
  // over every card on Earth, seconds per page).
  // A performer's or a venue's dates: only theirs.
  if (f.participant && state.byPerson) return state.byPerson.get(f.participant) ?? [];
  if (f.venue && state.byVenue) return state.byVenue.get(f.venue) ?? [];
  // Around a point: only the map cells within reach.
  if (f.near) {
    const near = cardsAround(f.near.lat, f.near.lng, f.near.radiusKm);
    if (near) return near;
  }
  const byCountry = state.byCountry;
  if (byCountry) {
    if (f.country) return byCountry.get(f.country.toUpperCase()) ?? [];
    if (f.continent) return inContinent(byCountry, f.continent);
    if (f.city) {
      const d = getDestination(f.city);
      if (d?.kind === "country" && d.countryCode) return byCountry.get(d.countryCode) ?? [];
    }
  }
  if (!f.city || !state.grid) return state.cards.values();
  const d = getDestination(f.city);
  if (!d || d.kind !== "city") return state.cards.values();
  const out = new Set<EventCard>(state.byCity?.get(d.id) ?? []);
  const dLat = 0.4;
  const dLng = 0.4 / Math.max(0.15, Math.cos((d.lat * Math.PI) / 180));
  for (let la = Math.floor(d.lat - dLat); la <= Math.floor(d.lat + dLat); la++)
    for (let lo = Math.floor(d.lng - dLng); lo <= Math.floor(d.lng + dLng); lo++) for (const c of state.grid.get(cellKey(la, lo)) ?? []) out.add(c);
  return out;
}

function* rebuildSteps(gen: number): Generator<void, void, void> {
  // Gives way every few thousand records (the async rebuild pauses there; the sync one doesn't).
  let n = 0;
  const t0 = Date.now();
  const events = new Map<string, OmniEvent>();
  const venues = new Map<string, Venue>();
  const participants = new Map<string, Participant>();
  const offers = new Map<string, TicketOffer[]>();
  const offersById = new Map<string, TicketOffer>();
  const aliases = new Map<string, string>();
  const dedupe = new Map<string, string>(); // key → canonical event id
  // The same show listed by two sources (a city agenda and a ticket seller) rarely shares
  // exact coordinates or start times: same title, same day and venues within 400 m merge,
  // so its page compares both sellers.
  const byTitleDay = new Map<string, { id: string; lat: number; lng: number; provider: string }[]>();
  const sameShowElsewhere = (e: OmniEvent, v: Venue, t: string, day: string) => {
    if (t.length < 6) return undefined;
    return byTitleDay.get(day)?.find((c) => c.provider !== e.provenance.provider && haversineKm(c.lat, c.lng, v.lat, v.lng) < 0.4)?.id;
  };

  // Real providers first so that they win canonical status over demo data.
  // A fixed order (the registry's), so every server instance picks the same event as the
  // canonical one when two records are the same show, and links work on every instance.
  const rank = (id: string) => (id === "demo" ? 1e6 : ALL_PROVIDERS.findIndex((p) => p.id === id));
  const ordered = [...state.providerData.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  const slugAliases = new Map<string, string>();
  for (const [, batch] of ordered) {
    for (const v of batch.venues) venues.set(v.id, v);
    for (const p of batch.participants) participants.set(p.id, p);
  }
  for (const [, batch] of ordered) {
    for (const e of batch.events) {
      if (++n % 2000 === 0) yield;
      const v = venues.get(e.venueId);
      if (!v) continue;
      // Worked out once per record and venue, then kept with the record.
      let k = (e as OmniEvent & { [DEDUPE]?: DedupeKey })[DEDUPE];
      if (!k || k.v !== v) {
        const startMs = Date.parse(e.start);
        if (!Number.isFinite(startMs) || !Number.isFinite(v.lat) || !Number.isFinite(v.lng)) continue;
        // Conservative duplicate key: identical normalised title, same ~100 m venue cell,
        // start within the same 15-minute window. Similar names alone never merge.
        const t = titleOf(e);
        k = { v, t, startMs, key: `${t}|${v.lat.toFixed(3)},${v.lng.toFixed(3)}|${Math.round(startMs / 900000)}`, day: `${t}|${Math.floor(startMs / 86400000)}` };
        keep(e, DEDUPE, k);
      }
      const { t, key } = k;
      const canonical = dedupe.get(key) ?? sameShowElsewhere(e, v, t, k.day);
      if (canonical && events.get(canonical)?.provenance.isDemo === e.provenance.isDemo) {
        aliases.set(e.id, canonical);
        slugAliases.set(e.slug, canonical);
        continue;
      }
      dedupe.set(key, e.id);
      events.set(e.id, canonicalCopy(e));
      const day = k.day;
      const same = byTitleDay.get(day);
      const entry = { id: e.id, lat: v.lat, lng: v.lng, provider: e.provenance.provider };
      if (same) same.push(entry);
      else byTitleDay.set(day, [entry]);
    }
    for (const o of batch.offers) {
      const eventId = aliases.get(o.eventId) ?? o.eventId;
      if (!events.has(eventId)) continue;
      const copy = offerCopy(o, eventId);
      const list = offers.get(eventId);
      if (list) list.push(copy);
      else offers.set(eventId, [copy]);
      offersById.set(o.id, copy);
    }
  }

  const cards = new Map<string, EventCard>();
  for (const e of events.values()) {
    if (++n % 2000 === 0) yield;
    cards.set(e.id, cardFor(e, venues, participants, offers.get(e.id) ?? NO_OFFERS));
  }
  const grid = new Map<string, EventCard[]>();
  const byCity = new Map<string, EventCard[]>();
  const byCountry = new Map<string, EventCard[]>();
  const byVenue = new Map<string, EventCard[]>();
  const byPerson = new Map<string, EventCard[]>();
  const file = (index: Map<string, EventCard[]>, key: string, c: EventCard) => {
    const list = index.get(key);
    if (list) list.push(c);
    else index.set(key, [c]);
  };
  for (const c of cards.values()) {
    if (++n % 4000 === 0) yield;
    file(byVenue, c.venueSlug, c);
    for (const p of c.people) file(byPerson, p.slug, c);
    const cc = venues.get(events.get(c.id)?.venueId ?? "")?.countryCode;
    if (cc) {
      const list = byCountry.get(cc);
      if (list) list.push(c);
      else byCountry.set(cc, [c]);
    }
    if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
      const k = cellKey(Math.floor(c.lat), Math.floor(c.lng));
      const list = grid.get(k);
      if (list) list.push(c);
      else grid.set(k, [c]);
    }
    if (c.cityId) {
      const list = byCity.get(c.cityId);
      if (list) list.push(c);
      else byCity.set(c.cityId, [c]);
    }
  }
  const bySlug = new Map<string, string>();
  for (const e of events.values()) {
    if (++n % 8000 === 0) yield;
    bySlug.set(e.slug, e.id);
  }
  // A merged duplicate's own link leads to the event it was merged into.
  for (const [slug, id] of slugAliases) if (!bySlug.has(slug)) bySlug.set(slug, id);
  const venuesBySlug = new Map<string, string>();
  for (const v of venues.values()) venuesBySlug.set(v.slug, v.id);
  yield;
  const participantsBySlug = new Map<string, string>();
  for (const p of participants.values()) participantsBySlug.set(p.slug, p.id);

  // A newer rebuild started meanwhile (it sees newer data): this one's work is dropped.
  if (gen !== rebuildGen) return;
  // Installed all at once, so a page never sees half of one index and half of another.
  state.events = events;
  state.venues = venues;
  state.participants = participants;
  state.offers = offers;
  state.offersById = offersById;
  state.aliases = aliases;
  state.cards = cards;
  state.bySlug = bySlug;
  state.venuesBySlug = venuesBySlug;
  state.participantsBySlug = participantsBySlug;
  state.grid = grid;
  state.byCity = byCity;
  state.byCountry = byCountry;
  state.byVenue = byVenue;
  state.byPerson = byPerson;
  state.cityStatsCache = undefined;
  const ms = Date.now() - t0;
  if (ms > 300) log("info", "indexes rebuilt", { ms, events: cards.size });
}

/** Each rebuild's number: only the newest one in flight may install its result. */
let rebuildGen = 0;

/** Rebuilds the indexes at once (blocks until done). */
function rebuildIndexes() {
  const it = rebuildSteps(++rebuildGen);
  while (!it.next().done);
}

let sliced: Promise<void> | undefined;
/** Search data being prepared after a new server has loaded (see warmSearch). */
let warming: Promise<void> | undefined;
let slicedAgain = false;
/**
 * The same rebuild, done in slices of a few dozen milliseconds: a big catalogue takes seconds to
 * index, and meanwhile the server keeps answering (from the index it already has). Calls during
 * one coalesce into one more pass afterwards.
 */
function rebuildIndexesSliced(): Promise<void> {
  if (sliced) {
    slicedAgain = true;
    return sliced;
  }
  sliced = (async () => {
    do {
      slicedAgain = false;
      const it = rebuildSteps(++rebuildGen);
      let until = Date.now() + 30;
      while (!it.next().done) {
        if (Date.now() < until) continue;
        await new Promise((r) => setImmediate(r));
        until = Date.now() + 30;
      }
    } while (slicedAgain);
  })()
    .catch((err) => {
      // Kept for the status page; the index in place stays as it was.
      hydrateInfo.rebuildErrors.push(String(err).slice(0, 160));
      log("error", "index rebuild failed", { err: String(err) });
    })
    .finally(() => (sliced = undefined));
  return sliced;
}

/** Works out, in slices, what searches need for every card not yet prepared. */
async function warmSearch(): Promise<void> {
  const cards = state.cards;
  let until = Date.now() + 25;
  for (const c of cards.values()) {
    if (state.cards !== cards) return; // a newer index: it gets prepared as searches use it
    cardText(c);
    startMsOf(c);
    const e = state.events.get(c.id);
    if (e) {
      simpleEvent(e);
      lastEnd(e);
    }
    if (Date.now() >= until) {
      await new Promise((r) => setImmediate(r));
      until = Date.now() + 25;
    }
  }
}

/** True while the indexes are being rebuilt in slices (the catalogue shown may be incomplete). */
export function indexing(): boolean {
  return !!sliced;
}

/** Whether this server shows its whole catalogue: nothing loading and the index up to date. */
export function catalogueComplete(): boolean {
  return !loadingNow() && !sliced;
}

function fromPrice(offers: TicketOffer[]): EventCard["fromPrice"] {
  const priced = offers.filter((o) => o.basePrice != null && o.availability !== "sold_out" && o.ticketCategory !== "child");
  if (!priced.length) return undefined;
  const best = priced.reduce((a, b) => (b.basePrice! < a.basePrice! ? b : a));
  return { amount: best.basePrice!, currency: best.currency, feesIncluded: best.feesIncluded };
}

/**
 * Lists many cards share, kept once: who sells the tickets (["ticketmaster"] on tens of
 * thousands of cards) and who performs (the same on every date of a tour). Cards are never
 * changed after they're made, so sharing is safe. Started afresh when large.
 */
const sharedLists = new Map<string, unknown>();
function sharedList<T>(key: string, make: () => T): T {
  let v = sharedLists.get(key) as T | undefined;
  if (v === undefined) {
    if (sharedLists.size > 200_000) sharedLists.clear();
    sharedLists.set(key, (v = make()));
  }
  return v;
}
function sellers(offers: TicketOffer[]): string[] {
  const list = [...new Set(offers.map((o) => o.provider))];
  return sharedList(`s${list.join("|")}`, () => list);
}
function cardPeople(e: OmniEvent, participants: Map<string, Participant>): EventCard["people"] {
  if (!e.participants.length) return sharedList("p", () => []);
  const list = e.participants
    .map((ep) => {
      const p = participants.get(ep.participantId);
      return p ? { name: p.name, slug: p.slug, role: ep.role } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  return sharedList(`p${list.map((p) => `${p.slug}\u0000${p.name}\u0000${p.role}`).join("\u0001")}`, () => list);
}

function toCard(e: OmniEvent, venues: Map<string, Venue>, participants: Map<string, Participant>, offers: TicketOffer[]): EventCard {
  const v = venues.get(e.venueId)!;
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    categorySlug: e.categorySlug,
    groupSlug: e.groupSlug,
    start: e.start,
    timeZone: e.timeZone,
    status: e.status,
    ticketAccess: e.ticketAccess,
    isFree: e.isFree,
    familyFriendly: e.familyFriendly,
    online: e.online,
    venueName: v.name,
    venueSlug: v.slug,
    city: v.city,
    cityId: v.cityId,
    country: v.country,
    lat: v.lat,
    lng: v.lng,
    imageUrl: e.imageUrl,
    posterHue: e.posterHue,
    people: cardPeople(e, participants),
    sports: e.sports,
    fromPrice: fromPrice(offers),
    providers: sellers(offers),
    isDemo: e.provenance.isDemo,
    provider: e.provenance.provider,
    lastSyncedAt: e.provenance.lastSyncedAt,
    editorialPick: e.editorialPick,
    eventType: e.eventType,
    hoursUnknown: e.hoursUnknown,
  };
}

// ------------------------------------------------------------------ queries

const DAY = 864e5;
const addDaysYMD = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const DEFAULT_DURATION_MIN = 120;

const INTERVALS = Symbol("intervals");
const SIMPLE = Symbol("simple");

/** Scheduled [start, end) intervals of an event: the main run plus any repeat performances (worked out once per record; not to be changed by callers). */
function eventIntervals(e: OmniEvent): [number, number][] {
  const kept = (e as OmniEvent & { [INTERVALS]?: [number, number][] })[INTERVALS];
  if (kept) return kept;
  return keep(e, INTERVALS, intervalsOf(e));
}

/** One performance of a day or less: how a search shows it doesn't depend on the dates asked. */
function simpleEvent(e: OmniEvent): boolean {
  const kept = (e as OmniEvent & { [SIMPLE]?: boolean })[SIMPLE];
  if (kept !== undefined) return kept;
  return keep(e, SIMPLE, !e.schedule?.length && (!e.end || Date.parse(e.end) - Date.parse(e.start) <= DAY));
}

/** A card's start as a number, worked out once per card (kept beside it: cards go to the browser as they are). */
const startMs = new WeakMap<EventCard, number>();
function startMsOf(c: EventCard): number {
  let t = startMs.get(c);
  if (t === undefined) startMs.set(c, (t = Date.parse(c.start)));
  return t;
}

function intervalsOf(e: OmniEvent): [number, number][] {
  const s = Date.parse(e.start);
  const dur = (Number.isFinite(e.durationMinutes) && e.durationMinutes! > 0 ? e.durationMinutes! : DEFAULT_DURATION_MIN) * 60000;
  // Events without an end time are assumed to last their stated duration, else two hours.
  const end = e.end ? Date.parse(e.end) : NaN;
  const main: [number, number] = [s, Number.isFinite(end) ? Math.max(end, s + 60000) : s + dur];
  const extra = (e.schedule ?? []).map((p): [number, number] => [Date.parse(p), Date.parse(p) + dur]);
  // A malformed date from a source must not break every search.
  return [main, ...extra].filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
}

const LIVE_MAX_MS = 14 * 3600000;

/**
 * On right now: a timed event that has started and not yet ended. All-day listings, daily
 * attractions and long runs (exhibitions, festivals over days) don't count, or "now" would
 * mean every museum on Earth.
 */
export function isLiveNow(e: OmniEvent, now = Date.now()): boolean {
  if (e.hoursUnknown || e.eventType === "daily_attraction" || e.status === "cancelled" || e.status === "postponed") return false;
  if (!(Date.parse(e.start) <= now)) return false;
  return eventIntervals(e).some(([a, b]) => a <= now && now < b && b - a <= LIVE_MAX_MS);
}

/**
 * Date/time filter. The search window is local wall-clock time interpreted in the venue's own
 * zone; an event matches when any of its scheduled intervals overlaps any day's window.
 * Daily attractions are matched on their daily opening hours.
 */
let whenErrorLogged = false;
/** matchesWhen, but one bad record from a source can't fail the whole search. */
function safeWhen(e: OmniEvent, f: SearchFilters): boolean {
  try {
    return matchesWhen(e, f);
  } catch (err) {
    if (!whenErrorLogged) log("error", "date filter failed for an event", { id: e.id, start: e.start, end: e.end, tz: e.timeZone, err: String(err) });
    whenErrorLogged = true;
    return false;
  }
}

// A zone's UTC offset per UTC day (NaN on the rare days its clocks change), so most events
// need no time-zone lookup of their own: one per zone and day is shared by all its events.
const dayOffsets = new Map<string, Map<number, number>>();
/** Day number (days since 1970-01-01) of the local calendar day an instant falls on in `tz`. */
function localDay(t: number, tz: string): number {
  const d = Math.floor(t / DAY);
  let m = dayOffsets.get(tz);
  if (!m) dayOffsets.set(tz, (m = new Map()));
  let off = m.get(d);
  if (off === undefined) {
    const a = tzOffsetMs(d * DAY, tz);
    off = a === tzOffsetMs((d + 1) * DAY, tz) ? a : NaN;
    if (m.size > 20000) m.clear();
    m.set(d, off);
  }
  return Math.floor((t + (Number.isNaN(off) ? tzOffsetMs(t, tz) : off)) / DAY);
}
const dayNums = new Map<string, number>();
/** Day number of a YYYY-MM-DD date. */
function dayNum(ymd: string): number {
  let n = dayNums.get(ymd);
  if (n === undefined) {
    n = Math.floor(Date.parse(`${ymd}T00:00:00Z`) / DAY);
    if (dayNums.size > 5000) dayNums.clear();
    dayNums.set(ymd, n);
  }
  return n;
}

// Events are replaced (not changed) when sources refresh, so spans are cached per event object.
const spanCache = new WeakMap<OmniEvent, Int32Array>();
/**
 * The local calendar days each scheduled interval of an event is on, as [first, last] day
 * numbers in its venue's zone (a daily attraction: its first and last open day). Worked out
 * once per event, so date filters are plain number comparisons.
 */
function daySpans(e: OmniEvent, tz: string): Int32Array {
  let sp = spanCache.get(e);
  if (sp) return sp;
  if (e.eventType === "daily_attraction") {
    const a = Date.parse(e.start);
    const b = e.end ? Date.parse(e.end) : NaN;
    sp = Int32Array.of(localDay(a, tz), localDay(Number.isFinite(b) ? b : a, tz));
  } else {
    const ivs = eventIntervals(e);
    sp = new Int32Array(ivs.length * 2);
    // A performance belongs to the day it starts (a club night from 23:30 to 05:00 is that
    // evening's, not the next day's); a run of more than a day covers every day it spans.
    ivs.forEach(([a, b], i) => {
      sp![2 * i] = localDay(a, tz);
      sp![2 * i + 1] = b - a > DAY ? localDay(b - 1, tz) : sp![2 * i];
    });
  }
  spanCache.set(e, sp);
  return sp;
}

function matchesWhen(e: OmniEvent, f: SearchFilters): boolean {
  if (f.tFrom || f.tTo) return matchesWhenSlow(e, f);
  // Whole days only: an event matches when one of its intervals touches a day in the range.
  const tz = isValidTimeZone(e.timeZone) ? e.timeZone : "UTC";
  const from = f.from ? dayNum(f.from) : localDay(Date.now(), tz);
  const to = f.to ? dayNum(f.to) : f.from ? from : from + 3650;
  if (to < from || !Number.isFinite(Date.parse(e.start))) return false;
  const sp = daySpans(e, tz);
  for (let i = 0; i < sp.length; i += 2) if (sp[i] <= to && sp[i + 1] >= from) return true;
  return false;
}

const endCache = new WeakMap<OmniEvent, number>();
/** When the last scheduled performance (or the run) ends. */
function lastEnd(e: OmniEvent): number {
  let t = endCache.get(e);
  if (t === undefined) {
    t = e.eventType === "daily_attraction" ? Date.parse(e.end ?? "") : Math.max(-Infinity, ...eventIntervals(e).map((iv) => iv[1]));
    if (!Number.isFinite(t)) t = Infinity; // open-ended
    endCache.set(e, t);
  }
  return t;
}

/**
 * The card as it should read for a search: dated by its first performance in the period
 * asked for (without dates: the next one from now), with `until` for a run lasting more than
 * a day and `ongoing` when that run began before the period. A weekly class found for
 * January shows its January date, not the first one in October.
 */
export function present(c: EventCard, f: SearchFilters, now = Date.now()): EventCard {
  const e = state.events.get(c.id);
  if (!e || e.eventType === "daily_attraction") return c;
  // One performance (the usual case): it matched, so it reads as it is.
  if (simpleEvent(e)) return c;
  const tz = isValidTimeZone(e.timeZone) ? e.timeZone : "UTC";
  const ivs = eventIntervals(e);
  const sp = daySpans(e, tz);
  const dated = !!(f.from || f.to);
  const from = f.from ? dayNum(f.from) : localDay(now, tz);
  const to = f.to ? dayNum(f.to) : f.from ? from : Infinity;
  let best = -1;
  for (let i = 0; i < ivs.length; i++) {
    const hit = dated ? sp[2 * i] <= to && sp[2 * i + 1] >= from : ivs[i][1] > now;
    if (hit && (best < 0 || ivs[i][0] < ivs[best][0])) best = i;
  }
  if (best < 0) return c;
  const [a, b] = ivs[best];
  const long = b - a > DAY;
  const ongoing = long && (dated ? sp[2 * best] < from : a < now);
  if (a === startMsOf(c) && !long) return c;
  return { ...c, start: new Date(a).toISOString(), until: long ? new Date(b).toISOString() : undefined, ongoing: ongoing || undefined };
}

/** Where a source's copy spends its bytes (for the status page): per field, in a sample. */
export function batchSizes(id: string): Record<string, unknown> | undefined {
  const b = state.providerData.get(id);
  if (!b) return undefined;
  const fields = (rows: object[]) => {
    const out: Record<string, number> = {};
    const sample = rows.slice(0, 3000);
    for (const r of sample) for (const [k, v] of Object.entries(r)) out[k] = (out[k] ?? 0) + JSON.stringify(v ?? null).length + k.length + 4;
    const scale = rows.length / Math.max(1, sample.length);
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, Math.round((n * scale) / 1024)]));
  };
  return { counts: { events: b.events.length, venues: b.venues.length, participants: b.participants.length, offers: b.offers.length }, kb: { events: fields(b.events), venues: fields(b.venues), participants: fields(b.participants), offers: fields(b.offers) } };
}

/** Internals exposed to unit tests only. */
export const __testing = {
  matchesWhen: (e: OmniEvent, f: SearchFilters) => matchesWhen(e, f),
  matchesWhenSlow: (e: OmniEvent, f: SearchFilters) => matchesWhenSlow(e, f),
  textScore: (c: EventCard, terms: string[]) => textScore(c, terms),
  /** For timing the index on a big catalogue: put a batch in place and rebuild. */
  load: (id: string, batch: ProviderBatch) => state.providerData.set(id, batch),
  rebuild: () => rebuildIndexes(),
  rebuildSliced: () => rebuildIndexesSliced(),
  drop: (id: string) => state.providerData.delete(id),
  /** Whether zoomed-in globe views look only at nearby map cells (off: at every card). */
  around: (on: boolean) => void (aroundOn = on),
  /** Forgets remembered search answers and counts. */
  forget: () => (searchMemo.clear(), countMemo.clear()),
};

/** The general date and local-time-window match (slower: builds each day's window in the venue's zone). */
function matchesWhenSlow(e: OmniEvent, f: SearchFilters): boolean {
  const tz = isValidTimeZone(e.timeZone) ? e.timeZone : "UTC";
  const from = f.from ?? todayIn(tz);
  // No end date means everything scheduled, however far ahead.
  const to = f.to ?? (f.from ? f.from : addDaysYMD(from, 3650));
  if (to < from) return false;
  // Without known hours we cannot say whether it is on during a time window.
  if (e.hoursUnknown && (f.tFrom || f.tTo)) return false;

  if (e.eventType === "daily_attraction") {
    const first = localDateKey(e.start, tz);
    const last = localDateKey(new Date(e.end ? Date.parse(e.end) : Date.parse(e.start)), tz);
    if (last < from || first > to) return false;
    if (!f.tFrom && !f.tTo) return true;
    // Compare minutes-of-day: opening hours vs the requested window (either may pass midnight).
    const local = Date.parse(e.start) + tzOffsetMs(Date.parse(e.start), tz);
    const open = Math.floor((((local % DAY) + DAY) % DAY) / 60000);
    const close = open + (e.durationMinutes ?? 480);
    const [sh, sm] = parseHM(f.tFrom ?? "00:00");
    const [eh, em] = parseHM(f.tTo ?? "24:00");
    const ws = sh * 60 + sm;
    let we = eh * 60 + em;
    if (we <= ws) we += 1440;
    for (const shift of [-1440, 0, 1440]) if (open + shift < we && ws < close + shift) return true;
    return false;
  }

  for (const iv of eventIntervals(e)) {
    // Only build windows for days this interval can touch (one day earlier for overnight windows).
    const lo = [addDaysYMD(localDateKey(new Date(iv[0]), tz), -1), from].sort()[1];
    const hi = [localDateKey(new Date(iv[1] - 1), tz), to].sort()[0];
    if (lo > hi) continue;
    if (!f.tFrom && !f.tTo && Date.parse(`${hi}T00:00:00Z`) - Date.parse(`${lo}T00:00:00Z`) > 2 * DAY) return true;
    const span = Math.min(62, (Date.parse(`${hi}T00:00:00Z`) - Date.parse(`${lo}T00:00:00Z`)) / DAY);
    const windows = windowIntervals(lo, addDaysYMD(lo, span), tz, f.tFrom, f.tTo);
    if (windows.some((w) => overlaps(w, iv))) return true;
  }
  return false;
}

/** In a destination: a city (or within 40 km of it), a country or a continent. */
function inPlace(c: EventCard, e: OmniEvent, id: string): boolean {
  const d = getDestination(id);
  if (!d) return false;
  if (d.kind === "city") return c.cityId === d.id || haversineKm(c.lat, c.lng, d.lat, d.lng) <= 40;
  const cc = state.venues.get(e.venueId)?.countryCode;
  if (d.kind === "country") return cc === d.countryCode;
  return !!cc && getDestination(cc.toLowerCase())?.continent === d.id;
}

const phrases = new Map<string, { terms: string[]; cats?: Set<string> }>();
/** A keyword or phrase: its words (all must match), and the category it names, if any. */
function phrase(p: string) {
  let x = phrases.get(p);
  if (!x) {
    const n = norm(p);
    const cat = CATEGORIES.find((k) => k.slug === p || norm(k.name) === n || norm(k.slug) === n || k.keywords?.some((w) => norm(w) === n));
    x = { terms: n.split(" ").filter((t) => t.length > 1), cats: cat ? descendantsOf(cat.slug) : undefined };
    if (phrases.size > 2000) phrases.clear();
    phrases.set(p, x);
  }
  return x;
}
/**
 * A phrase naming a category ("theatre", "teatro") matches events filed under it, or with it in
 * their title or performers (not a concert at a venue called "Theatre"); any other phrase
 * matches the title, performers, category, venue or place.
 */
function matchesPhrase(c: EventCard, p: string): boolean {
  const x = phrase(p);
  if (!x.terms.length) return false;
  if (!x.cats) return textScore(c, x.terms) > 0;
  if (x.cats.has(c.categorySlug) || x.cats.has(c.groupSlug)) return true;
  const t = cardText(c);
  return x.terms.every((w) => t.title.includes(` ${w}`) || t.people.includes(` ${w}`));
}

export function matches(c: EventCard, f: SearchFilters, catSets?: Set<string>[]): boolean {
  const e = state.events.get(c.id);
  if (!e) return false;
  if (f.source === "demo" && !c.isDemo) return false;
  if (f.source === "live" && c.isDemo) return false;
  if (catSets?.length && !catSets.some((s) => s.has(c.categorySlug) || s.has(c.groupSlug))) return false;
  if (f.live && !isLiveNow(e)) return false;

  // Dates and local times, evaluated in each event's own venue time zone.
  if (f.from || f.to || f.tFrom || f.tTo) {
    if (!safeWhen(e, f)) return false;
  } else if (!f.status?.includes("completed") && (c.status === "completed" || lastEnd(e) < Date.now())) {
    return false; // hide past events by default
  }

  if (f.city) {
    const d = getDestination(f.city);
    if (d?.kind === "city") {
      if (c.cityId !== d.id && haversineKm(c.lat, c.lng, d.lat, d.lng) > 40) return false;
    } else if (d?.kind === "country") {
      if (state.venues.get(e.venueId)?.countryCode !== d.countryCode) return false;
    } else if (d?.kind === "continent") {
      const v = state.venues.get(e.venueId);
      const cc = CITIES.find((x) => x.countryCode === v?.countryCode)?.continent;
      if (cc !== d.id) return false;
    }
  }
  if (f.country && state.venues.get(e.venueId)?.countryCode !== f.country.toUpperCase()) return false;
  if (f.places?.length && !f.places.some((p) => inPlace(c, e, p))) return false;
  if (f.anyOf?.length && !f.anyOf.some((p) => matchesPhrase(c, p))) return false;
  if (f.continent) {
    const v = state.venues.get(e.venueId);
    const cont = getDestination((v?.countryCode ?? "").toLowerCase())?.continent;
    if (cont !== f.continent) return false;
  }
  if (f.near) {
    // Online-only events have no physical location, so they never match a radius search.
    if (c.online) return false;
    // Great-circle (haversine) distance: exact for any radius, latitude or the antimeridian.
    const d = haversineKm(c.lat, c.lng, f.near.lat, f.near.lng);
    if (d > f.near.radiusKm) return false;
  }
  if (f.access === "free" && !(c.isFree || c.ticketAccess === "free")) return false;
  if (f.access === "ticketed" && c.ticketAccess !== "ticketed") return false;
  if (f.access === "registration" && c.ticketAccess !== "registration") return false;
  if (f.family && !c.familyFriendly) return false;
  if (f.online === "online" && !c.online) return false;
  if (f.online === "in_person" && c.online) return false;
  if (f.accessible && !(e.accessibility?.length || state.venues.get(e.venueId)?.accessibility?.length)) return false;
  if (f.indoor) {
    const indoor = state.venues.get(e.venueId)?.indoor;
    if (indoor === undefined || (f.indoor === "indoor") !== indoor) return false;
  }
  if (f.status?.length && !f.status.includes(c.status)) return false;
  if (f.participant && !c.people.some((p) => p.slug === f.participant)) return false;
  if (f.venue && c.venueSlug !== f.venue) return false;
  if (f.group && !groupKeys(f.group).has(f.group.deg <= 0 ? `v:${e.venueId}` : gridKey(c.lat, c.lng, f.group.deg))) return false;
  if (f.sport && c.sports?.sport.toLowerCase() !== f.sport.toLowerCase()) return false;
  if (f.competition && c.sports?.competition !== f.competition) return false;

  if (f.minPrice != null || f.maxPrice != null) {
    if (c.isFree) {
      if ((f.minPrice ?? 0) > 0) return false;
    } else {
      if (!c.fromPrice) return false; // unknown price never matches a price filter
      const cur = f.currency ?? c.fromPrice.currency;
      const amount = convert(c.fromPrice.amount, c.fromPrice.currency, cur);
      if (amount == null) return false;
      if (f.minPrice != null && amount < f.minPrice) return false;
      if (f.maxPrice != null && amount > f.maxPrice) return false;
    }
  }
  return true;
}

/** A category's own name ("Stand-up comedy"), so keywords find events filed under it. */
const categoryNames = (slug: string) => getCategory(slug)?.name ?? "";

// Normalised text of each card for keyword search, worked out once per card.
const textCache = new WeakMap<EventCard, { title: string; people: string; place: string; cat: string; words: string[] }>();
/**
 * One copy of texts many cards share (a venue's place line, a category's words, a tour's
 * title, common words): the search text of a couple of hundred thousand cards otherwise
 * holds the same few thousand texts over and over. Started afresh when it grows large.
 */
const textPool = new Map<string, string>();
function pooled(s: string): string {
  const kept = textPool.get(s);
  if (kept !== undefined) return kept;
  if (textPool.size > 400_000) textPool.clear();
  textPool.set(s, s);
  return s;
}
/** The longer words of a title and its people (shared by a tour's dates). */
const wordLists = new Map<string, string[]>();
function wordsOf(title: string, people: string): string[] {
  const key = `${title}|${people}`;
  let w = wordLists.get(key);
  if (!w) {
    if (wordLists.size > 200_000) wordLists.clear();
    w = `${title} ${people}`
      .split(" ")
      .filter((x) => x.length >= 5)
      .map(pooled);
    wordLists.set(key, w);
  }
  return w;
}
function cardText(c: EventCard) {
  let t = textCache.get(c);
  if (!t) {
    const title = pooled(` ${norm(c.title)}`);
    const people = pooled(` ${(c.people ?? []).map((p) => norm(p?.name)).join(" ")}`);
    t = {
      title,
      people,
      place: pooled(` ${norm(`${c.venueName} ${c.city} ${c.country}`)}`),
      cat: pooled(` ${norm(`${c.categorySlug} ${c.groupSlug} ${categoryNames(c.categorySlug)} ${c.sports?.competition ?? ""} ${c.sports?.sport ?? ""}`)}`),
      words: wordsOf(title, people),
    };
    textCache.set(c, t);
  }
  return t;
}

/**
 * Keyword match. Every term must match (AND), at the start of a word, so "art" finds
 * "Art Basel" and "artists" but not "party". Long words also forgive one typo.
 */
function textScore(c: EventCard, terms: string[]): number {
  if (!terms.length) return 1;
  const x = cardText(c);
  let score = 0;
  for (const t of terms) {
    const w = ` ${t}`;
    let s = 0;
    if (x.title.includes(w)) s = x.title.startsWith(w) ? 6 : 4;
    else if (x.people.includes(w)) s = 4;
    else if (x.cat.includes(w)) s = 2;
    else if (x.place.includes(w)) s = 1.5;
    else if (t.length >= 6 && hasNearWord(x.words, t)) s = 2;
    if (!s) return 0; // AND semantics
    score += s;
  }
  return score;
}

/** Whether two words differ by at most one letter added, removed or changed (linear time). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la > lb) return withinOneEdit(b, a);
  let i = 0;
  while (i < la && a[i] === b[i]) i++;
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1);
  return a.slice(i) === b.slice(i + 1);
}

// Every word long enough to forgive a typo in, by length, from the whole catalogue: a search
// finds the words one letter away from what was typed once, then each event is a quick lookup
// (comparing the typed word with every event's words, letter by letter, took most of a second).
let vocabOf: Map<string, EventCard> | undefined;
let vocab = new Map<number, Set<string>>();
const nearCache = new Map<string, Set<string>>();
function nearWords(t: string): Set<string> {
  if (vocabOf !== state.cards) {
    vocabOf = state.cards;
    vocab = new Map();
    nearCache.clear();
    for (const c of state.cards.values())
      for (const w of cardText(c).words) {
        let set = vocab.get(w.length);
        if (!set) vocab.set(w.length, (set = new Set()));
        set.add(w);
      }
  }
  let near = nearCache.get(t);
  if (!near) {
    near = new Set();
    for (let len = t.length - 1; len <= t.length + 1; len++) for (const w of vocab.get(len) ?? []) if (withinOneEdit(w, t)) near.add(w);
    if (nearCache.size > 500) nearCache.clear();
    nearCache.set(t, near);
  }
  return near;
}
function hasNearWord(words: string[], t: string): boolean {
  const near = nearWords(t);
  if (!near.size) return false;
  for (const w of words) if (near.has(w)) return true;
  return false;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/**
 * For each list of categories, the `n` soonest events matching `f` in one of them: what
 * searchEvents({ ...f, categories: list, pageSize: n }).items gives for each list, in one
 * pass over the cards instead of one search per list (a continent's page shows four such rows).
 */
export function soonestByCategories(f: SearchFilters, lists: string[][], n: number): EventCard[][] {
  const sets = lists.map((list) => list.map((cat) => descendantsOf(cat)));
  const base: SearchFilters = { ...f, categories: undefined, q: undefined };
  const found: EventCard[][] = lists.map(() => []);
  const now = Date.now();
  const hit: boolean[] = new Array(lists.length);
  for (const c of candidates(base)) {
    // The categories first: the cheapest test, and it rules out most cards.
    let any = false;
    for (let i = 0; i < sets.length; i++) any = (hit[i] = sets[i].some((s) => s.has(c.categorySlug) || s.has(c.groupSlug))) || any;
    if (!any || !matches(c, base)) continue;
    const shown = present(c, base, now);
    for (let i = 0; i < sets.length; i++) if (hit[i]) found[i].push(shown);
  }
  // The same order as a search by date.
  const windowStart = base.from ? Date.parse(`${base.from}T00:00:00Z`) : Date.now() - 6 * 3600000;
  const late = (c: EventCard) => Number(c.eventType === "daily_attraction" || !!c.ongoing || !!c.hoursUnknown);
  const at = (c: EventCard) => (c.ongoing ? windowStart : startMsOf(c));
  return found.map((list) => {
    const keyed = list.map((c, i) => ({ c, u: late(c), t: at(c), i }));
    keyed.sort((a, b) => a.u - b.u || a.t - b.t || a.i - b.i);
    return keyed.slice(0, n).map((k) => k.c);
  });
}

function catSetsFor(f: SearchFilters) {
  return f.categories?.length ? f.categories.map((c) => descendantsOf(c)) : undefined;
}

/**
 * The first `k` of `0…n-1` in the order `cmp` gives, as a stable sort would put them. A page
 * of 24 out of 200,000 results doesn't need the other 199,976 put in order.
 */
export function firstInOrder(n: number, k: number, cmp: (a: number, b: number) => number): number[] {
  if (n <= 4 * k || k > 2000) {
    const all = Array.from({ length: n }, (_, i) => i);
    return all.sort(cmp).slice(0, k);
  }
  const top: number[] = [];
  for (let i = 0; i < n; i++) {
    // Not before the last kept one: a stable sort would put it after (ties keep their order).
    if (top.length === k && cmp(i, top[k - 1]) >= 0) continue;
    let lo = 0;
    let hi = top.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cmp(top[mid], i) <= 0) lo = mid + 1;
      else hi = mid;
    }
    top.splice(lo, 0, i);
    if (top.length > k) top.pop();
  }
  return top;
}

type SearchResult = Paged<EventCard> & { facets: { groups: Record<string, number>; cities: Record<string, number> } };

/**
 * Answers to the searches asked for most (the events page, each category's, each city's), kept
 * for half a minute: the same search over a couple of hundred thousand events then costs
 * nothing for the next visitors. Dropped whenever the index changes.
 */
const searchMemo = new Map<string, { at: number; cards: Map<string, EventCard>; r: SearchResult }>();
const SEARCH_MEMO_MS = 30000;

export function searchEvents(f: SearchFilters): SearchResult {
  const key = JSON.stringify(f);
  const now = Date.now();
  const hit = searchMemo.get(key);
  if (hit && hit.cards === state.cards && now >= hit.at && now - hit.at < SEARCH_MEMO_MS) {
    // Most recently used last, so the oldest go first.
    searchMemo.delete(key);
    searchMemo.set(key, hit);
    return hit.r;
  }
  const r = runSearch(f);
  searchMemo.delete(key);
  searchMemo.set(key, { at: now, cards: state.cards, r });
  if (searchMemo.size > 120) searchMemo.delete(searchMemo.keys().next().value!);
  return r;
}

function runSearch(f: SearchFilters): SearchResult {
  const terms = f.q ? norm(f.q).split(" ").filter((t) => t.length > 1) : [];
  const catSets = catSetsFor(f);
  // Matches in two parallel lists (cards and their scores): no object per match.
  const found: EventCard[] = [];
  const score: number[] = [];
  const groups: Record<string, number> = {};
  const cities: Record<string, number> = {};
  const now = Date.now();
  for (const c of candidates(f)) {
    if (!matches(c, f, catSets)) continue;
    const s = textScore(c, terms);
    if (!s) continue;
    const shown = present(c, f, now);
    found.push(f.near ? { ...shown, distanceKm: haversineKm(c.lat, c.lng, f.near.lat, f.near.lng) } : shown);
    score.push(s);
    groups[c.groupSlug] = (groups[c.groupSlug] ?? 0) + 1;
    if (c.cityId) cities[c.cityId] = (cities[c.cityId] ?? 0) + 1;
  }
  const sort = f.sort ?? (terms.length ? "relevance" : "date");
  // Long runs that began before the period asked for (exhibitions, seasons) sort by when
  // the period starts, not by their opening years ago. Everything else sorts by the start
  // shown, even when it falls before midnight UTC of the first day (a Sydney morning).
  const windowStart = f.from ? Date.parse(`${f.from}T00:00:00Z`) : Date.now() - 6 * 3600000;
  const price = (c: EventCard) => (c.isFree ? 0 : c.fromPrice ? convert(c.fromPrice.amount, c.fromPrice.currency, f.currency ?? "USD") ?? Infinity : Infinity);
  // Sort keys worked out once per result (in flat arrays), not on every comparison.
  const n = found.length;
  const T = new Float64Array(n);
  const U = new Uint8Array(n);
  const P = new Float64Array(n);
  const A: string[] = sort === "announced" ? new Array(n) : [];
  for (let i = 0; i < n; i++) {
    const c = found[i];
    T[i] = c.ongoing ? windowStart : startMsOf(c);
    // Always-open attractions and listings with dates only don't have a meaningful "next"
    // start time, so they follow events with a real start time.
    U[i] = Number(c.eventType === "daily_attraction" || !!c.ongoing || !!c.hoursUnknown);
    if (sort === "price") P[i] = price(c);
    if (sort === "announced") A[i] = state.events.get(c.id)?.announcedAt ?? "";
  }
  const cmp = (a: number, b: number) => {
    switch (sort) {
      case "price": return P[a] - P[b] || T[a] - T[b];
      case "distance": return (found[a].distanceKm ?? Infinity) - (found[b].distanceKm ?? Infinity);
      case "announced": return A[a] < A[b] ? 1 : A[a] > A[b] ? -1 : 0;
      case "relevance": return score[b] - score[a] || T[a] - T[b];
      default: return U[a] - U[b] || T[a] - T[b];
    }
  };
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 24));
  const page = Math.max(1, f.page ?? 1);
  const total = n;
  const order = firstInOrder(n, page * pageSize, cmp);
  return {
    items: order.slice((page - 1) * pageSize, page * pageSize).map((i) => found[i]),
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    facets: { groups, cities },
  };
}

const keySets = new WeakMap<object, Set<string>>();
function groupKeys(g: { keys: string[] }): Set<string> {
  let s = keySets.get(g);
  if (!s) keySets.set(g, (s = new Set(g.keys)));
  return s;
}

/** Viewport-aware clustering for the globe and 2D map. */
/**
 * A random handful of matching events for "Spin the globe", each in a different city where
 * possible. Real shows, concerts, games and parties with a picture and a start time are
 * likelier picks than workshops, listings without a picture or time, and always-open
 * attractions. `random` is injectable for tests.
 */
const LIVELY = new Set(["music", "theatre", "comedy", "festivals", "nightlife", "sports", "cinema", "exhibitions", "food-drink", "attractions"]);

export function sampleEvents(f: SearchFilters, n: number, random = Math.random): EventCard[] {
  const catSets = catSetsFor(f);
  // Nights out first: a concert or a match is a better surprise than a library workshop.
  const weight = (c: EventCard) =>
    (c.imageUrl ? 4 : 1) * (LIVELY.has(c.groupSlug) ? 4 : 1) * (c.hoursUnknown ? 0.4 : 1) * (c.eventType === "daily_attraction" ? 0.15 : 1) * (c.isDemo ? 0.05 : 1);
  // Weighted sampling without replacement (Efraimidis–Spirakis): keep the largest keys.
  const keyed: { c: EventCard; k: number }[] = [];
  for (const c of candidates(f)) {
    if (c.status === "cancelled" || c.status === "postponed" || c.online || !matches(c, f, catSets)) continue;
    keyed.push({ c, k: Math.pow(random(), 1 / weight(c)) });
  }
  keyed.sort((a, b) => b.k - a.k);
  const out: EventCard[] = [];
  const cities = new Set<string>();
  // Different cities first, then fill up if there aren't enough.
  for (const pass of [0, 1])
    for (const { c } of keyed) {
      if (out.length >= n) break;
      const city = c.cityId ?? `${c.city}|${c.country}`;
      if (out.includes(c) || (pass === 0 && cities.has(city))) continue;
      cities.add(city);
      out.push(c);
    }
  return out.map((c) => present(c, f));
}

/** What Night Flight stops at when no vibe is chosen: shows, concerts, matches, parties. */
const NIGHT_OUT = new Set(["music", "theatre", "comedy", "festivals", "nightlife", "sports", "cinema", "food-drink"]);
/** Evenings Night Flight visits: local start times from 17:00 to midnight. */
const EVENING_FROM = 17 * 60;
const FLIGHT_BANDS = 12;
const FLIGHT_MIN_KM = 350;

/**
 * "Night Flight": a route round the planet through tonight. Timed events starting within the
 * next day at 17:00–23:59 local time (or begun in the last hour), one per band of longitude
 * and city first, the most vivid likelier (a picture, a concert, a match, a show). Stops are
 * ordered by when evening reaches them, east to west, so the route follows nightfall.
 * `random` and `now` are injectable for tests.
 */
export function nightFlight(opts: { n?: number; groups?: string[]; now?: number; random?: () => number } = {}): EventCard[] {
  const n = Math.max(1, Math.min(16, opts.n ?? 10));
  const now = opts.now ?? Date.now();
  const random = opts.random ?? Math.random;
  const catSets = opts.groups?.length ? opts.groups.map((g) => descendantsOf(g)) : undefined;
  // A place to stop needs a name on the card; a night out beats a club meeting.
  const weight = (c: EventCard) => (c.imageUrl ? 5 : 1) * (c.city ? 1 : 0.1) * (c.isDemo ? 0.02 : 1);
  type Stop = { c: EventCard; at: number; local: number; k: number };
  const pool: Stop[] = [];
  for (const c of state.cards.values()) {
    if (c.status === "cancelled" || c.status === "postponed" || c.online || c.hoursUnknown || c.eventType === "daily_attraction") continue;
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng) || !isValidTimeZone(c.timeZone)) continue;
    if (catSets ? !catSets.some((s) => s.has(c.categorySlug) || s.has(c.groupSlug)) : !NIGHT_OUT.has(c.groupSlug)) continue;
    const e = state.events.get(c.id);
    if (!e) continue;
    // The first performance in the window that falls in a local evening (repeat shows too).
    let at = NaN;
    let local = 0;
    for (const [a, b] of eventIntervals(e)) {
      if (a < now - 3600000 || a > now + DAY || b - a > LIVE_MAX_MS) continue;
      const mins = Math.floor((((a + tzOffsetMs(a, c.timeZone)) % DAY) + DAY) % DAY / 60000);
      if (mins < EVENING_FROM) continue;
      if (Number.isNaN(at) || a < at) {
        at = a;
        local = mins;
      }
    }
    if (!Number.isFinite(at)) continue;
    pool.push({ c, at, local, k: Math.pow(random(), 1 / weight(c)) });
  }
  pool.sort((a, b) => b.k - a.k);
  const out: Stop[] = [];
  const cities = new Set<string>();
  const band = (s: Stop) => Math.floor((((s.c.lng + 180) % 360) + 360) % 360 / (360 / FLIGHT_BANDS));
  const bands = new Set<number>();
  // One per band of longitude first, then anywhere far enough from the stops so far, then any new city.
  for (const pass of [0, 1, 2])
    for (const s of pool) {
      if (out.length >= n) break;
      const city = s.c.cityId ?? `${s.c.city}|${s.c.country}`;
      if (cities.has(city)) continue;
      if (pass === 0 && bands.has(band(s))) continue;
      if (pass <= 1 && out.some((o) => haversineKm(o.c.lat, o.c.lng, s.c.lat, s.c.lng) < FLIGHT_MIN_KM)) continue;
      cities.add(city);
      bands.add(band(s));
      out.push(s);
    }
  // When evening reaches each place: the instant of 20:00 local on the stop's day.
  const dusk = (s: Stop) => s.at - (s.local - 20 * 60) * 60000;
  out.sort((a, b) => dusk(a) - dusk(b) || a.at - b.at);
  return out.map((s) => (Date.parse(s.c.start) === s.at ? s.c : { ...s.c, start: new Date(s.at).toISOString(), until: undefined, ongoing: undefined }));
}

/** Mixtape tracks lean towards nights out: talks and trade fairs are rarely what a weekend is made of. */
const MIX_WORKY = new Set(["conferences", "technology", "education"]);
const mixJitter = (id: string) => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return 0.7 + ((h >>> 0) % 1000) / 1666;
};

/**
 * What a Mixtape in a city can be made of, from one local date to another: each event with its
 * performances in that time (a start and an end), or, for things you drop in on (an
 * exhibition, an attraction, a market that runs all day), its opening window each day. Prices
 * are in the city's currency. At most `limit` events, the likeliest picks first, with no one
 * kind taking more than a third of the places; events in `include` (a shared tape's) always
 * make it when they're on.
 */
export function mixtapePool(cityId: string, fromDate: string, toDate: string, limit = 450, include?: Set<string>): { items: MixCandidate[]; total: number } {
  const d = getDestination(cityId);
  if (!d || d.kind !== "city") return { items: [], total: 0 };
  const tz = d.timeZone && isValidTimeZone(d.timeZone) ? d.timeZone : "UTC";
  const cur = d.currency ?? "EUR";
  const W0 = windowIntervals(fromDate, fromDate, tz)[0][0];
  // Through the last night (until six the next morning).
  const W1 = windowIntervals(toDate, toDate, tz)[0][1] + 6 * 3600000;
  const f: SearchFilters = { city: cityId, from: fromDate, to: toDate };
  const MIN45 = 45 * 60000;

  type Scored = { c: MixCandidate; s: number };
  const all: Scored[] = [];
  for (const c of candidates(f)) {
    if (c.status === "cancelled" || c.status === "postponed" || c.online || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
    if (!matches(c, f)) continue;
    const e = state.events.get(c.id);
    if (!e) continue;
    const times: [number, number][] = [];
    const open: [number, number][] = [];
    let loose = false;
    let until: number | undefined;
    // Each local day of [a, b) inside the window, open from `o` to `cl` ("HH:MM").
    const daily = (a: number, b: number, o: string, cl: string) => {
      const lo = Math.max(a, W0);
      const hi = Math.min(b, W1);
      if (hi <= lo) return;
      const first = localDateKey(new Date(lo), tz);
      const last = localDateKey(new Date(hi - 1), tz);
      for (let day = first, i = 0; day <= last && i < 8; day = addDaysYMD(day, 1), i++) {
        const [w] = windowIntervals(day, day, tz, o, cl);
        const s = Math.max(w[0], a, W0);
        const en = Math.min(w[1], b, W1);
        if (en - s >= MIN45) open.push([s, en]);
      }
    };
    const hm = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    const dayStart = (t: number) => windowIntervals(localDateKey(new Date(t), tz), localDateKey(new Date(t), tz), tz)[0][0];
    if (e.eventType === "daily_attraction") {
      const a = Date.parse(e.start);
      const b = e.end ? Date.parse(e.end) : a;
      if (!Number.isFinite(a)) continue;
      const first = dayStart(a);
      const last = windowIntervals(localDateKey(new Date(Number.isFinite(b) ? b : a), tz), localDateKey(new Date(Number.isFinite(b) ? b : a), tz), tz)[0][1];
      if (e.hoursUnknown) {
        loose = true;
        daily(first, last, "10:00", "18:00");
      } else {
        const opens = Math.floor((((a + tzOffsetMs(a, tz)) % DAY) + DAY) % DAY / 60000);
        const closes = Math.min(opens + (e.durationMinutes ?? 480), 24 * 60 + 300);
        daily(first, last, hm(opens), hm(closes));
      }
    } else if (e.hoursUnknown) {
      // Only the dates: the event is on those days, at times not given.
      loose = true;
      for (const [a, b] of eventIntervals(e)) daily(dayStart(a), Math.max(b, dayStart(a) + DAY), "10:00", "20:00");
    } else {
      for (const [a, b] of eventIntervals(e)) {
        if (b <= W0 || a >= W1) continue;
        const len = b - a;
        if (len <= 4 * 3600000) times.push([a, b]);
        // A long day (a market, a festival day): drop in while it's on.
        else if (len <= 16 * 3600000) {
          const s = Math.max(a, W0);
          const en = Math.min(b, W1);
          if (en - s >= MIN45) open.push([s, en]);
        }
        // A run over days or months (an exhibition, a season): its days, at the hours its
        // first and last dates give (else museum hours). Which days it's on may vary.
        else {
          const ta = Math.floor((((a + tzOffsetMs(a, tz)) % DAY) + DAY) % DAY / 60000);
          const tb = Math.floor((((b + tzOffsetMs(b, tz)) % DAY) + DAY) % DAY / 60000);
          const hours = tb - ta >= 60 && tb - ta <= 14 * 60;
          daily(a, b, hours ? hm(ta) : "10:00", hours ? hm(tb) : "19:00");
          until = Math.max(until ?? 0, b);
        }
      }
    }
    if (!times.length && !open.length) continue;
    times.sort((x, y) => x[0] - y[0]);
    open.sort((x, y) => x[0] - y[0]);
    const price = c.isFree ? 0 : c.fromPrice ? convert(c.fromPrice.amount, c.fromPrice.currency, cur) : undefined;
    const item: MixCandidate = {
      id: c.id,
      slug: c.slug,
      title: c.title,
      group: c.groupSlug,
      cat: c.categorySlug,
      venue: c.venueName,
      lat: Math.round(c.lat * 1e5) / 1e5,
      lng: Math.round(c.lng * 1e5) / 1e5,
      img: c.imageUrl,
      hue: c.posterHue,
      free: c.isFree,
      price: price == null ? undefined : Math.round(price * 100) / 100,
      family: c.familyFriendly || undefined,
      pick: c.editorialPick || undefined,
      demo: c.isDemo || undefined,
      times: times.length ? times.slice(0, 16) : undefined,
      open: open.length ? open.slice(0, 10) : undefined,
      loose: loose || undefined,
      until: until && !loose ? until : undefined,
    };
    const s = (c.imageUrl ? 3 : 1) * (times.length ? 1.5 : 1) * (LIVELY.has(c.groupSlug) ? 1.5 : 1) * (loose ? 0.6 : 1) * (c.isDemo ? 0.02 : 1) * (MIX_WORKY.has(c.groupSlug) ? 0.4 : 1) * mixJitter(c.id);
    all.push({ c: item, s });
  }
  all.sort((a, b) => b.s - a.s);
  const cap = Math.ceil(limit / 3);
  const perGroup = new Map<string, number>();
  const items: MixCandidate[] = include?.size ? all.filter((x) => include.has(x.c.id)).map((x) => x.c) : [];
  const taken = new Set(items.map((c) => c.id));
  for (const { c } of all) {
    if (items.length >= limit) break;
    if (taken.has(c.id)) continue;
    const n = perGroup.get(c.group) ?? 0;
    if (n >= cap) continue;
    perGroup.set(c.group, n + 1);
    items.push(c);
  }
  return { items, total: all.length };
}

/**
 * How many events match on each of `n` local days from `start` (dates in the filters are
 * ignored), within the view: the globe's timeline. One pass over the events.
 */
export function dayCounts(f: SearchFilters, view: { lat?: number; lng?: number; radiusKm?: number }, start: string, n: number): number[] {
  const s0 = dayNum(start);
  const days = Array.from({ length: n }, (_, i) => new Date((s0 + i) * DAY).toISOString().slice(0, 10));
  // The whole range as the date filter: matching then works exactly as for a single day.
  const base: SearchFilters = { ...f, from: days[0], to: days[n - 1], live: undefined, tFrom: undefined, tTo: undefined };
  const windowed = !!(f.tFrom || f.tTo);
  const catSets = catSetsFor(base);
  const terms = base.q ? norm(base.q).split(" ").filter((t) => t.length > 1) : [];
  const counts = new Array<number>(n).fill(0);
  for (const c of candidates(base)) {
    if (!matches(c, base, catSets) || !textScore(c, terms)) continue;
    if (view.radiusKm != null && view.lat != null && view.lng != null && haversineKm(c.lat, c.lng, view.lat, view.lng) > view.radiusKm) continue;
    const e = state.events.get(c.id)!;
    if (windowed) {
      // Local time windows need the general matcher, day by day.
      days.forEach((d, i) => {
        if (safeWhen(e, { ...f, from: d, to: d })) counts[i]++;
      });
      continue;
    }
    const sp = daySpans(e, isValidTimeZone(e.timeZone) ? e.timeZone : "UTC");
    let mask = 0;
    for (let k = 0; k < sp.length; k += 2) {
      const lo = Math.max(0, sp[k] - s0);
      const hi = Math.min(n - 1, sp[k + 1] - s0);
      for (let i = lo; i <= hi; i++) mask |= 1 << i;
    }
    for (let i = 0; mask; i++, mask >>>= 1) if (mask & 1) counts[i]++;
  }
  return counts;
}

/**
 * The cards in the 1° map cells that can hold a point within `radiusKm` of a place (a box
 * around the circle on the sphere), or null when that is most of the planet (then every card
 * is looked at anyway).
 */
let aroundOn = true;
function cardsAround(lat: number, lng: number, radiusKm: number): Iterable<EventCard> | null {
  const grid = aroundOn ? state.grid : undefined;
  // Wider views take in most cards anyway: looking at them all is then quicker.
  if (!grid || radiusKm > 800) return null;
  const r = radiusKm / EARTH_RADIUS_KM;
  const phi = (lat * Math.PI) / 180;
  // A pole within reach: every longitude is.
  if (Math.abs(phi) + r >= Math.PI / 2 - 0.01) return null;
  const dLat = (r * 180) / Math.PI + 0.01;
  const dLng = (Math.asin(Math.min(1, Math.sin(r) / Math.cos(phi))) * 180) / Math.PI + 0.01;
  if (dLng >= 179) return null;
  const lists: EventCard[][] = [];
  for (let la = Math.floor(lat - dLat); la <= Math.floor(lat + dLat); la++)
    for (let lo = Math.floor(lng - dLng); lo <= Math.floor(lng + dLng); lo++) {
      const list = grid.get(cellKey(la, lo));
      if (list) lists.push(list);
    }
  return (function* () {
    for (const list of lists) yield* list;
  })();
}

/** How many cards match (as a search counts them), kept for half a minute per filter set. */
const countMemo = new Map<string, { at: number; cards: Map<string, EventCard>; n: number }>();
function matchCount(f: SearchFilters, catSets: Set<string>[] | undefined, terms: string[]): number {
  const key = JSON.stringify(f);
  const now = Date.now();
  const hit = countMemo.get(key);
  if (hit && hit.cards === state.cards && now >= hit.at && now - hit.at < SEARCH_MEMO_MS) return hit.n;
  let n = 0;
  for (const c of candidates(f)) if (matches(c, f, catSets) && textScore(c, terms)) n++;
  countMemo.delete(key);
  countMemo.set(key, { at: now, cards: state.cards, n });
  if (countMemo.size > 120) countMemo.delete(countMemo.keys().next().value!);
  return n;
}

/** Where a card sits on the globe (a point on the unit sphere) and how wide grid cells are there, worked out once per card. */
const geoCache = new WeakMap<EventCard, { x: number; y: number; z: number; w: number }>();
function geoOf(c: EventCard) {
  let g = geoCache.get(c);
  if (!g) {
    const [x, y, z] = latLngToVec3(c.lat, c.lng);
    geoCache.set(c, (g = { x, y, z, w: cellWidthFactor(c.lat) }));
  }
  return g;
}

/** The `n` earliest-starting cards, in order (one pass; big groups hold tens of thousands). */
function earliest(cards: EventCard[], n: number): EventCard[] {
  const top: EventCard[] = [];
  for (const c of cards) {
    if (top.length === n && c.start >= top[n - 1].start) continue;
    let i = top.length - (top.length === n ? 1 : 0);
    if (top.length === n) top.pop();
    while (i > 0 && top[i - 1].start > c.start) i--;
    top.splice(i, 0, c);
  }
  return top;
}

export function clusterEvents(
  f: SearchFilters,
  view: { lat?: number; lng?: number; radiusKm?: number; cellDeg: number; mergeDeg?: number },
): { clusters: Cluster[]; total: number; inView: number } {
  const catSets = catSetsFor(f);
  const terms = f.q ? norm(f.q).split(" ").filter((t) => t.length > 1) : [];
  // Grid cells are numbered while counting (cheaper than naming each card's cell) and named
  // once per group at the end, as gridKey names them.
  const buckets = new Map<string | number, { cards: EventCard[]; sx: number; sy: number; sz: number; live: number }>();
  let total = 0;
  let inView = 0;
  const now = Date.now();
  const cell = view.cellDeg;
  // Zoomed in: only the map cells around the view are looked at, and the total (the same
  // while the globe is moved around) is counted once and kept for a moment.
  const around = view.radiusKm != null && view.lat != null && view.lng != null ? cardsAround(view.lat, view.lng, view.radiusKm) : null;
  if (around) total = matchCount(f, catSets, terms);
  for (const c of around ?? candidates(f)) {
    if (around) {
      if (haversineKm(c.lat, c.lng, view.lat!, view.lng!) > view.radiusKm! || !matches(c, f, catSets) || !textScore(c, terms)) continue;
    } else {
      if (!matches(c, f, catSets) || !textScore(c, terms)) continue;
      total++;
      if (view.radiusKm != null && view.lat != null && view.lng != null && haversineKm(c.lat, c.lng, view.lat, view.lng) > view.radiusKm) continue;
    }
    inView++;
    const g = geoOf(c);
    let key: string | number;
    if (cell <= 0) key = `v:${state.events.get(c.id)?.venueId}`;
    else {
      const [latCell, lngCell] = gridCell(c.lat, c.lng, cell, g.w);
      key = latCell * 1e6 + lngCell;
    }
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { cards: [], sx: 0, sy: 0, sz: 0, live: 0 }));
    b.sx += g.x; b.sy += g.y; b.sz += g.z;
    b.cards.push(c);
    // Only something that has started can be on now.
    if (startMsOf(c) <= now) {
      const e = state.events.get(c.id);
      if (e && isLiveNow(e, now)) b.live++;
    }
  }
  const clusters: Cluster[] = [];
  for (const [k, b] of buckets) {
    const key = typeof k === "number" ? `${Math.floor(k / 1e6)}:${k % 1e6}` : k;
    const n = b.cards.length;
    // Spherical centroid (robust across the antimeridian).
    const len = Math.hypot(b.sx, b.sy, b.sz) || 1;
    const lat = 90 - (Math.acos(b.sy / len) * 180) / Math.PI;
    let lng = (Math.atan2(b.sz / len, -b.sx / len) * 180) / Math.PI - 180;
    if (lng < -180) lng += 360;
    const groups: Record<string, number> = {};
    const cityCounts: Record<string, number> = {};
    for (const c of b.cards) {
      groups[c.groupSlug] = (groups[c.groupSlug] ?? 0) + 1;
      const ck = c.cityId ?? c.city;
      cityCounts[ck] = (cityCounts[ck] ?? 0) + 1;
    }
    const dominant = Object.entries(groups).sort((a, b) => b[1] - a[1])[0][0];
    const topCity = Object.entries(cityCounts).sort((a, b) => b[1] - a[1])[0][0];
    const cityName = getDestination(topCity)?.name ?? b.cards[0].city;
    const extraCities = Object.keys(cityCounts).length - 1;
    const sample = earliest(b.cards, 6).map((c) => present(c, f));
    // The farthest member from the centre, along the globe (the smallest dot product of
    // unit vectors is the widest angle).
    let minDot = 1;
    const ux = b.sx / len, uy = b.sy / len, uz = b.sz / len;
    for (const c of b.cards) {
      const g = geoOf(c);
      const dot = g.x * ux + g.y * uy + g.z * uz;
      if (dot < minDot) minDot = dot;
    }
    const radiusKm = Math.acos(Math.max(-1, Math.min(1, minDot))) * EARTH_RADIUS_KM;
    clusters.push({
      radiusKm,
      group: { deg: Math.max(0, view.cellDeg), keys: [key] },
      id: key,
      lat,
      lng,
      count: n,
      groups,
      dominant,
      label: view.cellDeg <= 0 ? b.cards[0].venueName : extraCities > 0 ? `${cityName} +${extraCities} more` : cityName,
      cityId: Object.keys(cityCounts).length === 1 ? (getDestination(topCity) ? topCity : undefined) : undefined,
      venueId: view.cellDeg <= 0 ? state.events.get(b.cards[0].id)?.venueId : undefined,
      sample,
      live: b.live,
    });
  }
  clusters.sort((a, b) => b.count - a.count);
  const merged = view.mergeDeg ? mergeClose(clusters, view.mergeDeg) : clusters;
  return { clusters: merged.slice(0, 1500), total, inView };
}

/**
 * Grid cells can split one city between neighbours, which puts markers on top of each other.
 * Larger groups absorb smaller ones whose centres are closer than `deg` (longitude scaled by
 * latitude). The larger group keeps its id, so a selection survives the merge.
 */
function mergeClose(clusters: Cluster[], deg: number): Cluster[] {
  const out: Cluster[] = [];
  // Venue-level groups keep their biggest venue's name: "Teatro Español +2 more".
  const extra = new Map<Cluster, { base: string; venues: number }>();
  // Hosts are indexed on a grid of `deg`-sized cells, so each group only checks its neighbours.
  const grid = new Map<string, Cluster[]>();
  const cellOf = (lat: number, lng: number) => [Math.floor(lat / deg), Math.floor(lng / deg)];
  const near = (o: Cluster, c: Cluster) => {
    const dLat = o.lat - c.lat;
    let dLng = Math.abs(o.lng - c.lng);
    if (dLng > 180) dLng = 360 - dLng;
    dLng *= Math.cos((((o.lat + c.lat) / 2) * Math.PI) / 180);
    return dLat * dLat + dLng * dLng < deg * deg;
  };
  // Longitude distance shrinks towards the poles, so search wider in longitude there.
  for (const c of clusters) {
    const [y, x] = cellOf(c.lat, c.lng);
    const span = Math.min(60, Math.ceil(1 / Math.max(0.05, Math.cos((c.lat * Math.PI) / 180))));
    let host: Cluster | undefined;
    for (let dy = -1; dy <= 1 && !host; dy++)
      for (let dx = -span; dx <= span && !host; dx++) host = grid.get(`${y + dy}:${x + dx}`)?.find((o) => near(o, c));
    if (!host) {
      const copy = { ...c, groups: { ...c.groups }, sample: [...c.sample], group: c.group && { deg: c.group.deg, keys: [...c.group.keys] } };
      out.push(copy);
      const k = `${y}:${x}`;
      grid.set(k, [...(grid.get(k) ?? []), copy]);
      continue;
    }
    const n = host.count + c.count;
    const before = { lat: host.lat, lng: host.lng, r: host.radiusKm ?? 0 };
    host.lat = (host.lat * host.count + c.lat * c.count) / n;
    host.lng = Math.abs(host.lng - c.lng) > 180 ? host.lng : (host.lng * host.count + c.lng * c.count) / n;
    // The merged group must still cover every event of both parts.
    host.radiusKm = Math.max(before.r + haversineKm(host.lat, host.lng, before.lat, before.lng), (c.radiusKm ?? 0) + haversineKm(host.lat, host.lng, c.lat, c.lng));
    host.count = n;
    host.live = (host.live ?? 0) + (c.live ?? 0);
    for (const [g, k] of Object.entries(c.groups)) host.groups[g] = (host.groups[g] ?? 0) + k;
    if (host.group && c.group) host.group.keys.push(...c.group.keys);
    host.dominant = Object.entries(host.groups).sort((a, b) => b[1] - a[1])[0][0];
    host.sample = earliest([...host.sample, ...c.sample], 6);
    if (c.venueId || extra.has(host)) {
      const e = extra.get(host) ?? { base: host.label, venues: 0 };
      e.venues++;
      extra.set(host, e);
      host.venueId = undefined;
      host.label = `${e.base} +${e.venues} more`;
    } else if (!/ \+\d+ more$/.test(c.label) && c.label !== host.label && !host.label.endsWith(" more")) {
      host.label = `${host.label} +1 more`;
    }
    if (host.cityId !== c.cityId) host.cityId = undefined;
  }
  return out;
}

export function getEventView(slugOrId: string): EventView | undefined {
  const id = state.bySlug.get(slugOrId) ?? state.aliases.get(slugOrId) ?? slugOrId;
  const e = state.events.get(id);
  if (!e) return undefined;
  const venue = state.venues.get(e.venueId)!;
  const offers = [...(state.offers.get(e.id) ?? [])];
  const people = e.participants
    .map((ep) => {
      const p = state.participants.get(ep.participantId);
      return p ? { ...p, role: ep.role } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  return { ...e, venue, offers, people, fromPrice: state.cards.get(e.id)?.fromPrice };
}

export function getCard(id: string): EventCard | undefined {
  return state.cards.get(state.aliases.get(id) ?? id);
}

export function getCards(ids: string[]): EventCard[] {
  return ids.map(getCard).filter((x): x is EventCard => !!x);
}

export function getOffer(id: string): TicketOffer | undefined {
  return state.offersById.get(id);
}

export function getVenueBySlug(slug: string): Venue | undefined {
  const id = state.venuesBySlug.get(slug);
  return id ? state.venues.get(id) : undefined;
}

export function getParticipantBySlug(slug: string): Participant | undefined {
  const id = state.participantsBySlug.get(slug);
  return id ? state.participants.get(id) : undefined;
}

export function venuesInCity(cityId: string): (Venue & { upcoming: number })[] {
  const counts = new Map<string, number>();
  for (const c of state.byCity?.get(cityId) ?? state.cards.values())
    if (c.cityId === cityId && c.status !== "completed") {
      const vid = state.events.get(c.id)!.venueId;
      counts.set(vid, (counts.get(vid) ?? 0) + 1);
    }
  return [...counts.entries()]
    .map(([id, n]) => ({ ...state.venues.get(id)!, upcoming: n }))
    .sort((a, b) => b.upcoming - a.upcoming);
}

export function participantsList(kind?: string, limit = 50): (Participant & { upcoming: number })[] {
  const counts = new Map<string, number>();
  for (const e of state.events.values())
    if (e.status !== "completed") for (const p of e.participants) counts.set(p.participantId, (counts.get(p.participantId) ?? 0) + 1);
  return [...state.participants.values()]
    .filter((p) => !kind || p.kind === kind)
    .map((p) => ({ ...p, upcoming: counts.get(p.id) ?? 0 }))
    .sort((a, b) => b.upcoming - a.upcoming || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function cityStats(): Record<string, { total: number; groups: Record<string, number> }> {
  if (state.cityStatsCache) return state.cityStatsCache;
  const out: Record<string, { total: number; groups: Record<string, number> }> = {};
  for (const c of state.cards.values()) {
    if (!c.cityId || c.status === "completed") continue;
    const s = (out[c.cityId] ??= { total: 0, groups: {} });
    s.total++;
    s.groups[c.groupSlug] = (s.groups[c.groupSlug] ?? 0) + 1;
  }
  state.cityStatsCache = out;
  return out;
}

export function groupCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of state.cards.values()) {
    if (c.status === "completed") continue;
    out[c.groupSlug] = (out[c.groupSlug] ?? 0) + 1;
    if (c.categorySlug !== c.groupSlug) out[c.categorySlug] = (out[c.categorySlug] ?? 0) + 1;
  }
  return out;
}

export function sportsMeta(): { sports: string[]; competitions: string[] } {
  const sports = new Set<string>();
  const comps = new Set<string>();
  for (const c of state.cards.values()) {
    if (c.sports?.sport) sports.add(c.sports.sport);
    if (c.sports?.competition) comps.add(c.sports.competition);
  }
  return { sports: [...sports].sort(), competitions: [...comps].sort() };
}

export function allSlugs(): { events: string[]; venues: string[]; participants: string[]; demo: boolean } {
  const live = [...state.events.values()].filter((e) => !e.provenance.isDemo);
  return {
    events: live.map((e) => e.slug),
    venues: [...state.venues.values()].filter((v) => !v.provenance.isDemo).map((v) => v.slug),
    participants: [...state.participants.values()].filter((p) => !p.provenance.isDemo).map((p) => p.slug),
    demo: live.length === 0,
  };
}

export function dataSummary() {
  let demo = 0, live = 0;
  for (const c of state.cards.values()) {
    if (c.isDemo) demo++;
    else live++;
  }
  return { demo, live, total: demo + live, venues: state.venues.size, participants: state.participants.size };
}

/** Suggestions for autocomplete across participants, venues and event titles. */
/** Names as compared in suggestions, worked out once per venue or performer. */
const nameNorms = new WeakMap<object, string>();
function normName(o: object, name: string): string {
  let n = nameNorms.get(o);
  if (n === undefined) nameNorms.set(o, (n = norm(name)));
  return n;
}

export function suggestEntities(q: string, limit = 6) {
  const t = norm(q);
  if (t.length < 2) return { participants: [], venues: [], events: [] };
  const exact = (n: string) => (n.startsWith(t) ? 3 : n.includes(` ${t}`) ? 2 : n.includes(t) ? 1 : 0);
  // A word starting with what was typed, give or take one letter ("lisbn" → Lisbon).
  const near = (n: string) => {
    for (const w of n.split(" ")) if (w.length >= t.length - 1 && withinOneEdit(w.slice(0, t.length), t)) return true;
    return false;
  };
  // Exact matches first; only when the search as a whole finds too few, words one letter off
  // (looked for in a bounded number of names, so a search that matches nothing stays quick).
  const exactHits = <T extends object>(items: () => Iterable<T>, name: (x: T) => string, ok: (x: T) => boolean = () => true) => {
    const hits: { x: T; s: number }[] = [];
    for (const x of items()) {
      if (!ok(x)) continue;
      const s = exact(name(x));
      if (s) hits.push({ x, s });
    }
    return hits;
  };
  const people = exactHits(() => state.participants.values(), (p) => normName(p, p.name));
  const places = exactHits(() => state.venues.values(), (v) => normName(v, v.name));
  const shows = exactHits(() => state.cards.values(), (c) => cardText(c).title.slice(1), (c) => c.status !== "completed");
  const fuzzy = people.length + places.length + shows.length < limit && t.length >= 4;
  const top = <T extends object>(hits: { x: T; s: number }[], items: () => Iterable<T>, name: (x: T) => string, ok: (x: T) => boolean = () => true) => {
    if (fuzzy && hits.length < limit) {
      let looked = 0;
      for (const x of items()) {
        if (++looked > 80000 || hits.length >= limit * 3) break;
        if (!ok(x)) continue;
        const n = name(x);
        if (!exact(n) && near(n)) hits.push({ x, s: 0.5 });
      }
    }
    return hits
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((r) => r.x);
  };
  return {
    participants: top(people, () => state.participants.values(), (p) => normName(p, p.name)).map((p) => ({ slug: p.slug, name: p.name, kind: p.kind, isDemo: p.provenance.isDemo })),
    venues: top(places, () => state.venues.values(), (v) => normName(v, v.name)).map((v) => ({ slug: v.slug, name: v.name, city: v.city, isDemo: v.provenance.isDemo })),
    // Event titles use the search text worked out for every card when the index is built.
    events: top(shows, () => state.cards.values(), (c) => cardText(c).title.slice(1), (c) => c.status !== "completed").map((c) => ({ slug: c.slug, title: c.title, city: c.city, start: c.start, timeZone: c.timeZone, groupSlug: c.groupSlug, isDemo: c.isDemo, imageUrl: c.imageUrl, categorySlug: c.categorySlug, posterHue: c.posterHue })),
  };
}


/** Every card matching the filters, unsorted. */
export function matchingCards(f: SearchFilters): EventCard[] {
  const catSets = catSetsFor(f);
  const terms = f.q ? norm(f.q).split(" ").filter((t) => t.length > 1) : [];
  const out: EventCard[] = [];
  for (const c of candidates(f)) if (matches(c, f, catSets) && textScore(c, terms)) out.push(c);
  return out;
}
