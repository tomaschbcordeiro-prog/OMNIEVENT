import "server-only";
import { after } from "next/server";
import { acquireLock, cleanupSnapshots, loadSnapshot, releaseLock, saveSnapshot, setState, sharedEnabled, snapshotIndex } from "./shared-cache";
import { storageAvailable } from "./community/kv";
import { activeProviders, ALL_PROVIDERS } from "./providers/registry";
import type { ProviderAdapter, ProviderBatch } from "./providers/types";
import { CATEGORIES, descendantsOf, getCategory } from "./categories";
import { convert } from "./currency";
import { getDestination, CITIES } from "./destinations";
import { haversineKm, gridKey, latLngToVec3 } from "./geo";
import { localDateKey } from "./format";
import { windowIntervals, overlaps, todayIn, isValidTimeZone, parseHM, tzOffsetMs } from "./time";
import { log } from "./log";
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
/** When this instance last uploaded each source's snapshot. */
const savedAt = new Map<string, number>();
/** How recent each source's data on this instance is (its own sync or a loaded snapshot). */
const dataAt = new Map<string, number>();

/** How long the first requests a server answers may wait for its data. */
const FIRST_LOAD_WAIT = Number(process.env.FIRST_LOAD_WAIT_MS ?? 10000);

async function syncProvider(p: ProviderAdapter): Promise<void> {
  const existing = state.syncing.get(p.id);
  if (existing) return existing;
  const runId = `${p.id}-${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();
  const shared = sharedEnabled && !p.isDemo;
  const job = (async () => {
    // One instance reads a source at a time; the others pick up its snapshot. An instance
    // with nothing at all from a source reads it anyway, except sources with a daily quota.
    let locked = false;
    // Without the shared storage, instances can't share one read of a source with a daily
    // quota: each would spend the quota on its own, so those wait for the storage instead.
    if (shared && QUOTA_SOURCES.has(p.id) && !storageAvailable()) {
      state.lastSync.set(p.id, Date.now() - p.refreshIntervalMs + 10 * 60000);
      state.syncing.delete(p.id);
      return;
    }
    if (shared) {
      locked = await acquireLock(`sync:${p.id}`, 330);
      if (!locked && (QUOTA_SOURCES.has(p.id) || state.providerData.has(p.id))) {
        state.lastSync.set(p.id, Date.now() - p.refreshIntervalMs + 10 * 60000);
        state.syncing.delete(p.id);
        return;
      }
    }
    try {
      let lastPublish = 0;
      // What we had before this run: partial results published during it don't count as "updated".
      const before = state.providerData.get(p.id);
      const { batch, run } = await p.sync({
        maxEvents: Number(process.env.SYNC_MAX_EVENTS ?? 25000),
        log: (msg, extra) => log("info", msg, { provider: p.id, runId, ...extra }),
        // Partial results join what we already had; published at most every 20 seconds.
        onProgress: (partial) => {
          if (Date.now() - lastPublish < 20000) return;
          lastPublish = Date.now();
          const prev = state.providerData.get(p.id);
          const merged: ProviderBatch = { events: [...partial.events], venues: [...partial.venues], participants: [...partial.participants], offers: [...partial.offers] };
          if (prev) mergeMissing(merged, prev);
          state.providerData.set(p.id, merged);
          rebuildIndexes();
        },
      });
      const fresh = batch.events.length;
      const prev = state.providerData.get(p.id);
      const prevIds = new Set(before?.events.map((e) => e.id));
      // A run cut short (quota, network), or one that covered part of a long crawl, keeps
      // what we already had instead of dropping it.
      if (prev && (run.failures > 0 || run.partial)) mergeMissing(batch, prev);
      // Part of a crawl also joins the shared snapshot, which may hold earlier parts read by
      // other instances.
      if (shared && run.partial) {
        const meta = (await snapshotIndex().catch(() => ({}) as Record<string, never>))[p.id];
        if (meta && meta.at > (dataAt.get(p.id) ?? 0)) {
          const snap = await loadSnapshot(p.id, meta).catch(() => undefined);
          if (snap) mergeMissing(batch, snap);
        }
      }
      const updated = batch.events.filter((e) => prevIds.has(e.id)).length;
      state.providerData.set(p.id, batch);
      dataAt.set(p.id, Date.now());
      // A source that refused us with nothing to show is retried in 30 minutes, not after
      // its full refresh interval (and not every few minutes, which would waste quota).
      state.lastSync.set(p.id, run.rateLimited && !batch.events.length ? Date.now() - p.refreshIntervalMs + 30 * 60000 : Date.now());
      state.runs.set(p.id, { ...run, provider: p.id, runId, startedAt, updated, imported: batch.events.length - updated });
      // Every instance can then report how the last real run went, wherever it ran.
      // (A crawl's idle turn — nothing read, nothing wrong — doesn't replace the last real one.)
      if (shared && (fresh || run.error || !run.partial)) void setState(`run:${p.id}`, { ...state.runs.get(p.id), fresh }, 7 * 86400).catch(() => {});
      rebuildIndexes();
      log("info", "provider sync complete", { provider: p.id, runId, events: batch.events.length, failures: run.failures });
      // Shared only when this run brought something (a run that found nothing new doesn't
      // re-upload), and during a long crawl at most every 90 minutes to spare bandwidth.
      const lastSave = savedAt.get(p.id) ?? 0;
      if (shared && fresh && (!run.partial || Date.now() - lastSave > 90 * 60000 || !(run.error ?? "").includes("left"))) {
        savedAt.set(p.id, Date.now());
        await saveSnapshot(p.id, batch).catch((err) => {
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
      state.syncing.delete(p.id);
      if (locked) await releaseLock(`sync:${p.id}`);
    }
  })();
  state.syncing.set(p.id, job);
  return job;
}

function mergeMissing(batch: ProviderBatch, prev: ProviderBatch) {
  const have = <T extends { id: string }>(list: T[]) => new Set(list.map((x) => x.id));
  const ev = have(batch.events);
  const now = Date.now();
  for (const e of prev.events) if (!ev.has(e.id) && Date.parse(e.schedule?.at(-1) ?? e.end ?? e.start) > now) batch.events.push(e);
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
async function hydrate(providers: ProviderAdapter[]): Promise<void> {
  let index: Awaited<ReturnType<typeof snapshotIndex>>;
  try {
    index = await snapshotIndex();
    state.snapIndex = index;
  } catch (err) {
    log("error", "snapshot index failed", { err: String(err) });
    return;
  }
  let changed = false;
  await Promise.all(
    providers.map(async (p) => {
      const meta = index[p.id];
      if (!meta || p.isDemo || state.syncing.has(p.id) || meta.at <= (dataAt.get(p.id) ?? 0)) return;
      try {
        const batch = await loadSnapshot(p.id, meta);
        if (!batch || state.syncing.has(p.id)) return;
        state.providerData.set(p.id, batch);
        dataAt.set(p.id, meta.at);
        state.lastSync.set(p.id, Math.max(meta.at, state.lastSync.get(p.id) ?? 0));
        if (!state.runs.has(p.id))
          state.runs.set(p.id, { provider: p.id, runId: `shared-${meta.ver}`, startedAt: new Date(meta.at).toISOString(), finishedAt: new Date(meta.at).toISOString(), imported: batch.events.length, updated: 0, failures: 0, rateLimited: false, ok: true });
        changed = true;
      } catch (err) {
        (state.snapFailed ??= new Set()).add(p.id);
        log("error", "snapshot load failed", { provider: p.id, err: String(err) });
      }
    }),
  );
  if (changed) rebuildIndexes();
}

export async function ensureFresh(): Promise<void> {
  const providers = activeProviders();
  // A check stuck for over two minutes is abandoned so the next one can run.
  if (state.hydrating && Date.now() - (state.sharedCheckedAt ?? 0) > 120000) state.hydrating = undefined;
  if (sharedEnabled && !state.hydrating && Date.now() - (state.sharedCheckedAt ?? 0) > 5 * 60000) {
    const first = state.sharedCheckedAt === undefined;
    state.sharedCheckedAt = Date.now();
    state.hydrating = hydrate(providers).finally(() => (state.hydrating = undefined));
    // Old snapshot copies are cleared out (one instance, at most hourly).
    void cleanupSnapshots()
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
  const waits: Promise<void>[] = [];
  for (const p of providers) {
    const last = state.lastSync.get(p.id);
    if (last === undefined) {
      // A recent shared snapshot is on its way (or loading): don't re-read the whole source.
      const meta = state.snapIndex?.[p.id];
      if (meta && now - meta.at < p.refreshIntervalMs && !state.snapFailed?.has(p.id)) continue;
      waits.push(syncProvider(p));
    } else if (now - last > p.refreshIntervalMs) void syncProvider(p);
  }
  // A slow source must not hold the first page hostage: wait a bounded time, then serve
  // whatever has loaded while the rest keeps syncing in the background.
  // On serverless hosts an instance freezes once its response is sent; ask the platform to
  // keep it running until background syncs finish (bounded by the route's maxDuration).
  const running = [...state.syncing.values()];
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
 * True once this server holds every active source's data (or has given up on one). Before
 * that, answers may be missing sources and mustn't be cached for other visitors.
 */
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

const norm = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Works out each event's search text, local days and last end ahead of the first searches
 * that need them, a few thousand at a time so requests keep being served meanwhile.
 */
let warmGen = 0;
function warmUp() {
  const gen = ++warmGen;
  const cards = [...state.cards.values()];
  let i = 0;
  const step = () => {
    if (gen !== warmGen) return;
    const end = Math.min(cards.length, i + 4000);
    for (; i < end; i++) {
      const c = cards[i];
      const e = state.events.get(c.id);
      cardText(c);
      if (e) {
        lastEnd(e);
        daySpans(e, isValidTimeZone(e.timeZone) ? e.timeZone : "UTC");
      }
    }
    if (i < cards.length) setTimeout(step, 0);
  };
  setTimeout(step, 0);
}

// Ticket sellers sometimes give one show an "end" weeks or a year away (a pass's validity, a
// season's last date). A single show doesn't last days, so that end is dropped; runs the
// seller marks as such come in as multi-day events.
const SELLERS = new Set(["ticketmaster", "seatgeek", "skiddle"]);
function sane(e: OmniEvent): OmniEvent {
  if (e.eventType === "single" && e.end && SELLERS.has(e.provenance.provider) && Date.parse(e.end) - Date.parse(e.start) > DAY) return { ...e, end: undefined };
  return e;
}

function rebuildIndexes() {
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
  const sameShowElsewhere = (e: OmniEvent, v: Venue) => {
    const t = norm(e.title);
    if (t.length < 6) return undefined;
    const day = `${t}|${Math.floor(new Date(e.start).getTime() / 86400000)}`;
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
      const v = venues.get(e.venueId);
      if (!v || !Number.isFinite(Date.parse(e.start)) || !Number.isFinite(v.lat) || !Number.isFinite(v.lng)) continue;
      // Conservative duplicate key: identical normalised title, same ~100 m venue cell,
      // start within the same 15-minute window. Similar names alone never merge.
      const key = `${norm(e.title)}|${v.lat.toFixed(3)},${v.lng.toFixed(3)}|${Math.round(new Date(e.start).getTime() / 900000)}`;
      const canonical = dedupe.get(key) ?? sameShowElsewhere(e, v);
      if (canonical && events.get(canonical)?.provenance.isDemo === e.provenance.isDemo) {
        aliases.set(e.id, canonical);
        slugAliases.set(e.slug, canonical);
        continue;
      }
      dedupe.set(key, e.id);
      events.set(e.id, { ...sane(e), canonicalId: e.id });
      const day = `${norm(e.title)}|${Math.floor(new Date(e.start).getTime() / 86400000)}`;
      byTitleDay.set(day, [...(byTitleDay.get(day) ?? []), { id: e.id, lat: v.lat, lng: v.lng, provider: e.provenance.provider }]);
    }
    for (const o of batch.offers) {
      const eventId = aliases.get(o.eventId) ?? o.eventId;
      if (!events.has(eventId)) continue;
      const list = offers.get(eventId) ?? [];
      list.push({ ...o, eventId });
      offers.set(eventId, list);
      offersById.set(o.id, { ...o, eventId });
    }
  }

  const cards = new Map<string, EventCard>();
  for (const e of events.values()) cards.set(e.id, toCard(e, venues, participants, offers.get(e.id) ?? []));

  state.events = events;
  state.venues = venues;
  state.participants = participants;
  state.offers = offers;
  state.offersById = offersById;
  state.aliases = aliases;
  state.cards = cards;
  state.bySlug = new Map([...events.values()].map((e) => [e.slug, e.id]));
  // A merged duplicate's own link leads to the event it was merged into.
  for (const [slug, id] of slugAliases) if (!state.bySlug.has(slug)) state.bySlug.set(slug, id);
  state.venuesBySlug = new Map([...venues.values()].map((v) => [v.slug, v.id]));
  warmUp();
  state.participantsBySlug = new Map([...participants.values()].map((p) => [p.slug, p.id]));
}

function fromPrice(offers: TicketOffer[]): EventCard["fromPrice"] {
  const priced = offers.filter((o) => o.basePrice != null && o.availability !== "sold_out" && o.ticketCategory !== "child");
  if (!priced.length) return undefined;
  const best = priced.reduce((a, b) => (b.basePrice! < a.basePrice! ? b : a));
  return { amount: best.basePrice!, currency: best.currency, feesIncluded: best.feesIncluded };
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
    people: e.participants
      .map((ep) => {
        const p = participants.get(ep.participantId);
        return p ? { name: p.name, slug: p.slug, role: ep.role } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x),
    sports: e.sports,
    fromPrice: fromPrice(offers),
    providers: [...new Set(offers.map((o) => o.provider))],
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

/** Scheduled [start, end) intervals of an event: the main run plus any repeat performances. */
function eventIntervals(e: OmniEvent): [number, number][] {
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
  if (!e.schedule?.length && (!e.end || Date.parse(e.end) - Date.parse(e.start) <= DAY)) return c;
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
  if (a === Date.parse(c.start) && !long) return c;
  return { ...c, start: new Date(a).toISOString(), until: long ? new Date(b).toISOString() : undefined, ongoing: ongoing || undefined };
}

/** Internals exposed to unit tests only. */
export const __testing = { matchesWhen: (e: OmniEvent, f: SearchFilters) => matchesWhen(e, f), matchesWhenSlow: (e: OmniEvent, f: SearchFilters) => matchesWhenSlow(e, f) };

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
function cardText(c: EventCard) {
  let t = textCache.get(c);
  if (!t) {
    const title = ` ${norm(c.title)}`;
    const people = ` ${c.people.map((p) => norm(p.name)).join(" ")}`;
    t = {
      title,
      people,
      place: ` ${norm(`${c.venueName} ${c.city} ${c.country}`)}`,
      cat: ` ${norm(`${c.categorySlug} ${c.groupSlug} ${categoryNames(c.categorySlug)} ${c.sports?.competition ?? ""} ${c.sports?.sport ?? ""}`)}`,
      words: `${title} ${people}`.split(" ").filter((w) => w.length >= 5),
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
    else if (t.length >= 6 && x.words.some((v) => Math.abs(v.length - t.length) <= 1 && levenshtein(v, t) <= 1)) s = 2;
    if (!s) return 0; // AND semantics
    score += s;
  }
  return score;
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

function catSetsFor(f: SearchFilters) {
  return f.categories?.length ? f.categories.map((c) => descendantsOf(c)) : undefined;
}

export function searchEvents(f: SearchFilters): Paged<EventCard> & { facets: { groups: Record<string, number>; cities: Record<string, number> } } {
  const terms = f.q ? norm(f.q).split(" ").filter((t) => t.length > 1) : [];
  const catSets = catSetsFor(f);
  const scored: { c: EventCard; s: number }[] = [];
  const groups: Record<string, number> = {};
  const cities: Record<string, number> = {};
  for (const c of state.cards.values()) {
    if (!matches(c, f, catSets)) continue;
    const s = textScore(c, terms);
    if (!s) continue;
    const shown = present(c, f);
    const item = f.near ? { ...shown, distanceKm: haversineKm(c.lat, c.lng, f.near.lat, f.near.lng) } : shown;
    scored.push({ c: item, s });
    groups[c.groupSlug] = (groups[c.groupSlug] ?? 0) + 1;
    if (c.cityId) cities[c.cityId] = (cities[c.cityId] ?? 0) + 1;
  }
  const sort = f.sort ?? (terms.length ? "relevance" : "date");
  // Long runs that began before the period asked for (exhibitions, seasons) sort by when
  // the period starts, not by their opening years ago.
  const windowStart = f.from ? Date.parse(`${f.from}T00:00:00Z`) : Date.now() - 6 * 3600000;
  const price = (c: EventCard) => (c.isFree ? 0 : c.fromPrice ? convert(c.fromPrice.amount, c.fromPrice.currency, f.currency ?? "USD") ?? Infinity : Infinity);
  // Sort keys worked out once per result (in flat arrays), not on every comparison.
  const n = scored.length;
  const T = new Float64Array(n);
  const U = new Uint8Array(n);
  const P = new Float64Array(n);
  const A: string[] = sort === "announced" ? new Array(n) : [];
  for (let i = 0; i < n; i++) {
    const c = scored[i].c;
    T[i] = c.ongoing ? windowStart : Math.max(Date.parse(c.start), windowStart);
    // Always-open attractions and listings with dates only don't have a meaningful "next"
    // start time, so they follow events with a real start time.
    U[i] = Number(c.eventType === "daily_attraction" || !!c.ongoing || !!c.hoursUnknown);
    if (sort === "price") P[i] = price(c);
    if (sort === "announced") A[i] = state.events.get(c.id)?.announcedAt ?? "";
  }
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => {
    switch (sort) {
      case "price": return P[a] - P[b] || T[a] - T[b];
      case "distance": return (scored[a].c.distanceKm ?? Infinity) - (scored[b].c.distanceKm ?? Infinity);
      case "announced": return A[a] < A[b] ? 1 : A[a] > A[b] ? -1 : 0;
      case "relevance": return scored[b].s - scored[a].s || T[a] - T[b];
      default: return U[a] - U[b] || T[a] - T[b];
    }
  });
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 24));
  const page = Math.max(1, f.page ?? 1);
  const total = n;
  return {
    items: order.slice((page - 1) * pageSize, page * pageSize).map((i) => scored[i].c),
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
  for (const c of state.cards.values()) {
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
  const buckets = new Map<string, { cards: EventCard[]; sx: number; sy: number; sz: number; live: number }>();
  let total = 0;
  let inView = 0;
  const now = Date.now();
  for (const c of state.cards.values()) {
    if (!matches(c, f, catSets) || !textScore(c, terms)) continue;
    total++;
    if (view.radiusKm != null && view.lat != null && view.lng != null && haversineKm(c.lat, c.lng, view.lat, view.lng) > view.radiusKm) continue;
    inView++;
    const key = view.cellDeg <= 0 ? `v:${state.events.get(c.id)?.venueId}` : gridKey(c.lat, c.lng, view.cellDeg);
    const b = buckets.get(key) ?? { cards: [], sx: 0, sy: 0, sz: 0, live: 0 };
    const [x, y, z] = latLngToVec3(c.lat, c.lng);
    b.sx += x; b.sy += y; b.sz += z;
    b.cards.push(c);
    const e = state.events.get(c.id);
    if (e && isLiveNow(e, now)) b.live++;
    buckets.set(key, b);
  }
  const clusters: Cluster[] = [];
  for (const [key, b] of buckets) {
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
    let radiusKm = 0;
    for (const c of b.cards) radiusKm = Math.max(radiusKm, haversineKm(lat, lng, c.lat, c.lng));
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
  for (const c of state.cards.values())
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
  const out: Record<string, { total: number; groups: Record<string, number> }> = {};
  for (const c of state.cards.values()) {
    if (!c.cityId || c.status === "completed") continue;
    const s = (out[c.cityId] ??= { total: 0, groups: {} });
    s.total++;
    s.groups[c.groupSlug] = (s.groups[c.groupSlug] ?? 0) + 1;
  }
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
export function suggestEntities(q: string, limit = 6) {
  const t = norm(q);
  if (t.length < 2) return { participants: [], venues: [], events: [] };
  const score = (name: string) => {
    const n = norm(name);
    if (n.startsWith(t)) return 3;
    if (n.includes(` ${t}`)) return 2;
    if (n.includes(t)) return 1;
    if (t.length >= 4 && n.split(" ").some((w) => levenshtein(w.slice(0, t.length), t) <= 1)) return 0.5;
    return 0;
  };
  const top = <T,>(items: Iterable<T>, name: (x: T) => string) =>
    [...items]
      .map((x) => ({ x, s: score(name(x)) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((r) => r.x);
  return {
    participants: top(state.participants.values(), (p) => p.name).map((p) => ({ slug: p.slug, name: p.name, kind: p.kind, isDemo: p.provenance.isDemo })),
    venues: top(state.venues.values(), (v) => v.name).map((v) => ({ slug: v.slug, name: v.name, city: v.city, isDemo: v.provenance.isDemo })),
    events: top([...state.cards.values()].filter((c) => c.status !== "completed"), (c) => c.title).map((c) => ({ slug: c.slug, title: c.title, city: c.city, start: c.start, timeZone: c.timeZone, groupSlug: c.groupSlug, isDemo: c.isDemo })),
  };
}


/** Every card matching the filters, unsorted. */
export function matchingCards(f: SearchFilters): EventCard[] {
  const catSets = catSetsFor(f);
  const terms = f.q ? norm(f.q).split(" ").filter((t) => t.length > 1) : [];
  const out: EventCard[] = [];
  for (const c of state.cards.values()) if (matches(c, f, catSets) && textScore(c, terms)) out.push(c);
  return out;
}
