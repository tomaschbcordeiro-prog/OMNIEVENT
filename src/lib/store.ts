import "server-only";
import { activeProviders, ALL_PROVIDERS } from "./providers/registry";
import type { ProviderAdapter, ProviderBatch } from "./providers/types";
import { descendantsOf } from "./categories";
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

async function syncProvider(p: ProviderAdapter): Promise<void> {
  const existing = state.syncing.get(p.id);
  if (existing) return existing;
  const runId = `${p.id}-${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();
  const job = (async () => {
    try {
      const { batch, run } = await p.sync({
        maxEvents: Number(process.env.SYNC_MAX_EVENTS ?? 25000),
        log: (msg, extra) => log("info", msg, { provider: p.id, runId, ...extra }),
      });
      const prev = state.providerData.get(p.id);
      const prevIds = new Set(prev?.events.map((e) => e.id));
      // A run cut short (quota, network) keeps what we already had instead of dropping it.
      if (prev && run.failures > 0) mergeMissing(batch, prev);
      const updated = batch.events.filter((e) => prevIds.has(e.id)).length;
      state.providerData.set(p.id, batch);
      // A source that refused us with nothing to show is retried in 30 minutes, not after
      // its full refresh interval (and not every few minutes, which would waste quota).
      state.lastSync.set(p.id, run.rateLimited && !batch.events.length ? Date.now() - p.refreshIntervalMs + 30 * 60000 : Date.now());
      state.runs.set(p.id, { ...run, provider: p.id, runId, startedAt, updated, imported: batch.events.length - updated });
      rebuildIndexes();
      log("info", "provider sync complete", { provider: p.id, runId, events: batch.events.length, failures: run.failures });
    } catch (err) {
      state.runs.set(p.id, { provider: p.id, runId, startedAt, finishedAt: new Date().toISOString(), imported: 0, updated: 0, failures: 1, rateLimited: false, ok: false, error: String(err) });
      // Back off before retrying a failing provider.
      state.lastSync.set(p.id, Date.now() - p.refreshIntervalMs + 5 * 60000);
      log("error", "provider sync failed", { provider: p.id, runId, err: String(err) });
    } finally {
      state.syncing.delete(p.id);
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
export async function ensureFresh(): Promise<void> {
  const providers = activeProviders();
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
    if (last === undefined) waits.push(syncProvider(p));
    else if (now - last > p.refreshIntervalMs) void syncProvider(p);
  }
  // A slow source must not hold the first page hostage: wait a bounded time, then serve
  // whatever has loaded while the rest keeps syncing in the background.
  if (waits.length) {
    const limit = Number(process.env.FIRST_LOAD_WAIT_MS ?? 12000);
    await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, limit))]);
  }
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

function rebuildIndexes() {
  const events = new Map<string, OmniEvent>();
  const venues = new Map<string, Venue>();
  const participants = new Map<string, Participant>();
  const offers = new Map<string, TicketOffer[]>();
  const offersById = new Map<string, TicketOffer>();
  const aliases = new Map<string, string>();
  const dedupe = new Map<string, string>(); // key → canonical event id

  // Real providers first so that they win canonical status over demo data.
  const ordered = [...state.providerData.entries()].sort(([a], [b]) => (a === "demo" ? 1 : 0) - (b === "demo" ? 1 : 0));
  for (const [, batch] of ordered) {
    for (const v of batch.venues) venues.set(v.id, v);
    for (const p of batch.participants) participants.set(p.id, p);
  }
  for (const [, batch] of ordered) {
    for (const e of batch.events) {
      const v = venues.get(e.venueId);
      if (!v) continue;
      // Conservative duplicate key: identical normalised title, same ~100 m venue cell,
      // start within the same 15-minute window. Similar names alone never merge.
      const key = `${norm(e.title)}|${v.lat.toFixed(3)},${v.lng.toFixed(3)}|${Math.round(new Date(e.start).getTime() / 900000)}`;
      const canonical = dedupe.get(key);
      if (canonical && events.get(canonical)?.provenance.isDemo === e.provenance.isDemo) {
        aliases.set(e.id, canonical);
        continue;
      }
      dedupe.set(key, e.id);
      events.set(e.id, { ...e, canonicalId: e.id });
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
  state.venuesBySlug = new Map([...venues.values()].map((v) => [v.slug, v.id]));
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
  const dur = (e.durationMinutes ?? DEFAULT_DURATION_MIN) * 60000;
  // Events without an end time are assumed to last their stated duration, else two hours.
  const main: [number, number] = [s, e.end ? Math.max(Date.parse(e.end), s + 60000) : s + dur];
  const extra = (e.schedule ?? []).map((p): [number, number] => [Date.parse(p), Date.parse(p) + dur]);
  return [main, ...extra];
}

/**
 * Date/time filter. The search window is local wall-clock time interpreted in the venue's own
 * zone; an event matches when any of its scheduled intervals overlaps any day's window.
 * Daily attractions are matched on their daily opening hours.
 */
function matchesWhen(e: OmniEvent, f: SearchFilters): boolean {
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

export function matches(c: EventCard, f: SearchFilters, catSets?: Set<string>[]): boolean {
  const e = state.events.get(c.id);
  if (!e) return false;
  if (f.source === "demo" && !c.isDemo) return false;
  if (f.source === "live" && c.isDemo) return false;
  if (catSets?.length && !catSets.some((s) => s.has(c.categorySlug) || s.has(c.groupSlug))) return false;

  // Dates and local times, evaluated in each event's own venue time zone.
  if (f.from || f.to || f.tFrom || f.tTo) {
    if (!matchesWhen(e, f)) return false;
  } else if (!f.status?.includes("completed") && c.status === "completed") {
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

function textScore(c: EventCard, terms: string[]): number {
  if (!terms.length) return 1;
  const title = norm(c.title);
  const people = c.people.map((p) => norm(p.name)).join(" ");
  const place = norm(`${c.venueName} ${c.city} ${c.country}`);
  const cat = `${c.categorySlug} ${c.groupSlug} ${c.sports?.competition ?? ""} ${c.sports?.sport ?? ""}`.toLowerCase();
  let score = 0;
  for (const t of terms) {
    let s = 0;
    if (title.includes(t)) s = title.startsWith(t) ? 6 : 4;
    else if (people.includes(t)) s = 4;
    else if (cat.includes(t)) s = 2;
    else if (place.includes(t)) s = 1.5;
    else if (t.length >= 4) {
      // typo tolerance on whole words
      const words = `${title} ${people}`.split(" ");
      if (words.some((w) => Math.abs(w.length - t.length) <= 1 && levenshtein(w, t) <= 1)) s = 2;
    }
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
    const item = f.near ? { ...c, distanceKm: haversineKm(c.lat, c.lng, f.near.lat, f.near.lng) } : c;
    scored.push({ c: item, s });
    groups[c.groupSlug] = (groups[c.groupSlug] ?? 0) + 1;
    if (c.cityId) cities[c.cityId] = (cities[c.cityId] ?? 0) + 1;
  }
  const sort = f.sort ?? (terms.length ? "relevance" : "date");
  const t = (c: EventCard) => new Date(c.start).getTime();
  const undated = (c: EventCard) => Number(c.eventType === "daily_attraction" || !!c.hoursUnknown);
  const price = (c: EventCard) => (c.isFree ? 0 : c.fromPrice ? convert(c.fromPrice.amount, c.fromPrice.currency, f.currency ?? "USD") ?? Infinity : Infinity);
  scored.sort((a, b) => {
    switch (sort) {
      case "price": return price(a.c) - price(b.c) || t(a.c) - t(b.c);
      case "distance": return (a.c.distanceKm ?? Infinity) - (b.c.distanceKm ?? Infinity);
      case "announced": return (state.events.get(b.c.id)?.announcedAt ?? "").localeCompare(state.events.get(a.c.id)?.announcedAt ?? "");
      case "relevance": return b.s - a.s || t(a.c) - t(b.c);
      default:
        // Always-open attractions and listings with dates only don't have a meaningful "next"
        // start time, so they follow events with a real start time.
        return undated(a.c) - undated(b.c) || t(a.c) - t(b.c);
    }
  });
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 24));
  const page = Math.max(1, f.page ?? 1);
  const total = scored.length;
  return {
    items: scored.slice((page - 1) * pageSize, page * pageSize).map((x) => x.c),
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    facets: { groups, cities },
  };
}

/** Viewport-aware clustering for the globe and 2D map. */
export function clusterEvents(
  f: SearchFilters,
  view: { lat?: number; lng?: number; radiusKm?: number; cellDeg: number },
): { clusters: Cluster[]; total: number; inView: number } {
  const catSets = catSetsFor(f);
  const terms = f.q ? norm(f.q).split(" ").filter((t) => t.length > 1) : [];
  const buckets = new Map<string, { cards: EventCard[]; sx: number; sy: number; sz: number }>();
  let total = 0;
  let inView = 0;
  for (const c of state.cards.values()) {
    if (!matches(c, f, catSets) || !textScore(c, terms)) continue;
    total++;
    if (view.radiusKm != null && view.lat != null && view.lng != null && haversineKm(c.lat, c.lng, view.lat, view.lng) > view.radiusKm) continue;
    inView++;
    const key = view.cellDeg <= 0 ? `v:${state.events.get(c.id)?.venueId}` : gridKey(c.lat, c.lng, view.cellDeg);
    const b = buckets.get(key) ?? { cards: [], sx: 0, sy: 0, sz: 0 };
    const [x, y, z] = latLngToVec3(c.lat, c.lng);
    b.sx += x; b.sy += y; b.sz += z;
    b.cards.push(c);
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
    const sample = [...b.cards].sort((a, c) => a.start.localeCompare(c.start)).slice(0, 6);
    clusters.push({
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
    });
  }
  clusters.sort((a, b) => b.count - a.count);
  return { clusters: clusters.slice(0, 1500), total, inView };
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

/** Unpaginated match for server-side aggregation (calendars, counts). Never sent to the browser in full. */
export function matchingCards(f: SearchFilters): EventCard[] {
  const catSets = catSetsFor(f);
  const terms = f.q ? norm(f.q).split(" ").filter((t) => t.length > 1) : [];
  const out: EventCard[] = [];
  for (const c of state.cards.values()) if (matches(c, f, catSets) && textScore(c, terms)) out.push(c);
  return out;
}
