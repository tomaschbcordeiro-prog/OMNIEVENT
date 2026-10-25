import { groupOf } from "../categories";
import { getCountry, slugify } from "../destinations";
import type { OmniEvent, Participant, ParticipantKind, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { envList, fetchJson, nearestCityId, sleep } from "./common";
import { getState, setState } from "../shared-cache";

/**
 * SeatGeek Platform API (https://platform.seatgeek.com).
 *
 * - Requires SEATGEEK_CLIENT_ID (free, from seatgeek.com/account/develop).
 * - Coverage: mostly the US and Canada; SeatGeek is a primary seller for some teams and a
 *   resale marketplace for the rest, so offers are labelled "marketplace".
 * - `stats.lowest_price` is a listing price that changes constantly; we show it as "from"
 *   and never mark fees as included.
 */

const BASE = "https://api.seatgeek.com/2/events";
const DEFAULT_COUNTRIES = ["US", "CA"];

interface SgPerformer { id: number; name: string; slug?: string; url?: string; image?: string; type?: string; primary?: boolean; home_team?: boolean; away_team?: boolean }
interface SgVenue {
  id: number; name?: string; address?: string; extended_address?: string; city?: string; state?: string;
  country?: string; postal_code?: string; timezone?: string; url?: string; location?: { lat?: number; lon?: number };
}
export interface SgEvent {
  id: number; title?: string; short_title?: string; url?: string; type?: string;
  datetime_utc?: string; datetime_tbd?: boolean; time_tbd?: boolean; enddatetime_utc?: string | null;
  status?: string; announce_date?: string; description?: string;
  taxonomies?: { name?: string }[];
  performers?: SgPerformer[];
  venue?: SgVenue;
  stats?: { lowest_price?: number | null; highest_price?: number | null; listing_count?: number | null };
}

const TYPE_MAP: Record<string, string> = {
  concert: "concerts", music_festival: "music-festivals", classical: "classical", classical_opera: "opera", opera: "opera",
  classical_orchestral_instrumental: "classical", classical_vocal: "classical",
  nfl: "american-football", ncaa_football: "american-football", mlb: "baseball", nba: "basketball", ncaa_basketball: "basketball",
  wnba: "basketball", nhl: "ice-hockey", mls: "football", soccer: "football", nwsl: "football", tennis: "tennis",
  golf: "golf", pga: "golf", boxing: "combat", mma: "combat", wwe: "combat", wrestling: "combat", ufc: "combat",
  auto_racing: "motorsport", nascar: "motorsport", f1: "motorsport", indycar: "motorsport", monster_truck: "motorsport",
  rugby: "rugby", cricket: "cricket", horse_racing: "sports", minor_league_baseball: "baseball", minor_league_hockey: "ice-hockey",
  sports: "sports", theater: "plays", broadway_tickets_national: "musicals", musical: "musicals", dance_performance_tour: "dance",
  ballet: "ballet", cirque_du_soleil: "circus", comedy: "stand-up", family: "family-shows", film: "cinema", literary: "spoken-word",
};

export function mapSgType(type?: string, taxonomies?: { name?: string }[]): string {
  if (type && TYPE_MAP[type]) return TYPE_MAP[type];
  for (const t of taxonomies ?? []) if (t.name && TYPE_MAP[t.name]) return TYPE_MAP[t.name];
  const root = taxonomies?.[0]?.name;
  return root === "sports" ? "sports" : root === "concert" ? "concerts" : root === "theater" ? "plays" : "other";
}

/** SeatGeek returns UTC timestamps without a "Z". */
const utc = (s?: string | null) => (s ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`) : undefined);

/** Pure mapping function — unit-tested with fixtures in tests/sources.test.ts. */
export function normalizeSeatGeek(raw: SgEvent[], syncedAt: string): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const participants = new Map<string, Participant>();
  const offers: TicketOffer[] = [];
  const seen = new Set<number>();

  for (const e of raw) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const v = e.venue;
    const lat = Number(v?.location?.lat);
    const lng = Number(v?.location?.lon);
    const start = utc(e.datetime_utc);
    // Skip records we cannot place on the globe or in time, including dates still to be announced.
    if (!v || !e.title || !Number.isFinite(lat) || !Number.isFinite(lng) || !start || isNaN(+start) || e.datetime_tbd) continue;
    const cc = (v.country ?? "").toUpperCase().slice(0, 2);
    const venueId = `sg-v-${v.id}`;
    if (!venues.has(venueId)) {
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${v.name ?? "venue"}-${v.id}`),
        name: v.name ?? "Venue",
        address: v.address || undefined,
        city: v.city ?? "",
        cityId: nearestCityId(lat, lng),
        region: v.state,
        country: getCountry(cc)?.name ?? cc,
        countryCode: cc,
        lat,
        lng,
        timeZone: v.timezone || "UTC",
        url: v.url,
        provenance: { provider: "seatgeek", externalId: String(v.id), sourceUrl: v.url, lastSyncedAt: syncedAt, isDemo: false },
      });
    }
    const cat = mapSgType(e.type, e.taxonomies);
    const group = groupOf(cat);
    const people = (e.performers ?? []).map((p, i) => {
      const kind: ParticipantKind = group === "sports" ? "team" : group === "theatre" ? "production" : "artist";
      const id = `sg-p-${p.id}`;
      if (!participants.has(id))
        participants.set(id, {
          id,
          slug: slugify(`${p.name}-sg${p.id}`),
          name: p.name,
          kind,
          url: p.url,
          imageUrl: p.image || undefined,
          provenance: { provider: "seatgeek", externalId: String(p.id), sourceUrl: p.url, lastSyncedAt: syncedAt, isDemo: false },
        });
      const role = group === "sports" ? (p.home_team ? "team_home" as const : p.away_team ? "team_away" as const : "team" as const) : i === 0 ? "headliner" as const : "support" as const;
      return { participantId: id, role, order: i };
    });
    const id = `sg-e-${e.id}`;
    const cancelled = /cancel/i.test(e.status ?? "");
    const postponed = /postpone/i.test(e.status ?? "");
    const status = cancelled ? "cancelled" as const : postponed ? "postponed" as const : "on_sale" as const;
    const main = e.performers?.find((p) => p.primary) ?? e.performers?.[0];
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${e.title}-sg${e.id}`),
      title: e.title,
      description: e.description || undefined,
      categorySlug: cat,
      groupSlug: group,
      eventType: "single",
      venueId,
      start: start.toISOString(),
      end: utc(e.enddatetime_utc)?.toISOString(),
      timeZone: v.timezone || "UTC",
      status,
      statusNote: e.time_tbd ? "Start time to be confirmed." : undefined,
      ticketAccess: "ticketed",
      isFree: false,
      registrationRequired: false,
      online: false,
      familyFriendly: cat === "family-shows",
      officialUrl: e.url,
      imageUrl: main?.image || undefined,
      participants: people,
      sports: group === "sports" ? { sport: cat === "sports" ? "Sport" : cat.replace(/-/g, " "), league: e.type?.toUpperCase() } : undefined,
      announcedAt: utc(e.announce_date)?.toISOString(),
      provenance: { provider: "seatgeek", externalId: String(e.id), sourceUrl: e.url, lastSyncedAt: syncedAt, lastVerifiedAt: syncedAt, isDemo: false },
    });
    if (e.url && !cancelled) {
      const low = e.stats?.lowest_price ?? undefined;
      offers.push({
        id: `${id}-sg`,
        eventId: id,
        provider: "SeatGeek",
        providerType: "marketplace",
        providerEventId: String(e.id),
        ticketCategory: "standard",
        label: low != null ? "Lowest listing on SeatGeek" : "Listings on SeatGeek",
        basePrice: low ?? undefined,
        maxPrice: e.stats?.highest_price ?? undefined,
        currency: low != null ? "USD" : "",
        availability: e.stats?.listing_count === 0 ? "sold_out" : e.stats?.listing_count ? "available" : "unknown",
        purchaseUrl: e.url,
        priceObservedAt: low != null ? syncedAt : undefined,
        availabilityVerifiedAt: e.stats?.listing_count != null ? syncedAt : undefined,
        isDemo: false,
      });
    }
  }
  return { events, venues: [...venues.values()], participants: [...participants.values()], offers };
}

export const seatgeekProvider: ProviderAdapter = {
  id: "seatgeek",
  name: "SeatGeek Platform API",
  isDemo: false,
  coverage: "Concerts, sports and theatre in the US and Canada, with live marketplace prices.",
  attribution: "Event data and ticket links provided by SeatGeek.",
  isConfigured: () => !!process.env.SEATGEEK_CLIENT_ID,
  // Runs every half hour until the catalogue is read, then again after three hours (see sync).
  refreshIntervalMs: Number(process.env.SEATGEEK_RUN_EVERY_MINUTES ?? 30) * 60000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const raw = new Map<number, SgEvent>();
    let failures = 0;
    let lastError = "";
    let calls = 0;
    const maxCalls = Number(process.env.SEATGEEK_MAX_CALLS ?? 600);
    const PER_PAGE = 500;
    // SeatGeek answers at most ~10,000 results per query; windows above this are halved.
    const LIMIT = 5000;
    const HOUR = 3600000;
    const from = Math.floor(Date.now() / HOUR) * HOUR;
    const to = from + Number(process.env.SEATGEEK_DAYS_AHEAD ?? 730) * 86400000;
    const iso = (t: number) => new Date(t).toISOString().slice(0, 19);
    type Task = { cc: string; start: number; end: number; page: number; per?: number };
    const countries = envList("SEATGEEK_COUNTRIES", DEFAULT_COUNTRIES);
    // Runs are cut after a few minutes; the next one continues from the saved queue.
    const saved = await getState<{ countries: string; queue: Task[] }>("seatgeek:crawl");
    const resume = saved && saved.countries === countries.join(",") && saved.queue.length ? saved.queue.filter((t) => t.end > from) : undefined;
    const done = await getState<number>("seatgeek:complete");
    if (!resume && done && Date.now() - done < 3 * 3600000)
      return { batch: { events: [], venues: [], participants: [], offers: [] }, run: { imported: 0, updated: 0, failures: 0, rateLimited: false, ok: true, partial: true, finishedAt: new Date().toISOString() } };
    const queue: Task[] = resume ?? countries.map((cc) => ({ cc, start: from, end: to, page: 1 }));
    const deadline = Date.now() + Number(process.env.SEATGEEK_RUN_SECONDS ?? 220) * 1000;
    const deferred: Task[] = [];
    // Every event of each country, read in date windows small enough to page through.
    while (queue.length && calls < maxCalls && failures < 10 && Date.now() < deadline) {
      const t = queue.shift()!;
      const url = new URL(BASE);
      url.searchParams.set("client_id", process.env.SEATGEEK_CLIENT_ID!);
      if (process.env.SEATGEEK_CLIENT_SECRET) url.searchParams.set("client_secret", process.env.SEATGEEK_CLIENT_SECRET);
      url.searchParams.set("venue.country", t.cc);
      url.searchParams.set("datetime_utc.gte", iso(t.start));
      url.searchParams.set("datetime_utc.lt", iso(t.end));
      url.searchParams.set("per_page", String(t.per ?? PER_PAGE));
      url.searchParams.set("page", String(t.page));
      url.searchParams.set("sort", "datetime_utc.asc");
      calls++;
      try {
        const json = (await fetchJson("seatgeek", url, ctx, { revalidate: 0, timeoutMs: 45000 })) as { events?: SgEvent[]; meta?: { total?: number; per_page?: number } };
        const total = json.meta?.total ?? 0;
        // The API may serve fewer per page than asked; page by what it actually returns.
        const per = Math.max(1, Math.min(PER_PAGE, json.meta?.per_page ?? PER_PAGE));
        if (t.page === 1 && total > LIMIT && t.end - t.start > 2 * HOUR) {
          const mid = t.start + Math.floor((t.end - t.start) / 2 / HOUR) * HOUR;
          queue.unshift({ ...t, end: mid }, { ...t, start: mid });
          continue;
        }
        for (const e of json.events ?? []) raw.set(e.id, e);
        if (t.page === 1) for (let p = Math.min(Math.ceil(total / per), Math.floor(LIMIT / per)); p >= 2; p--) queue.unshift({ ...t, page: p, per });
        if (t.page === 1 || calls % 10 === 0) ctx.onProgress?.(normalizeSeatGeek([...raw.values()], syncedAt));
      } catch (err) {
        failures++;
        deferred.push(t);
        lastError = String(err).slice(0, 160);
        ctx.log("seatgeek page failed", { cc: t.cc, from: iso(t.start), page: t.page, err: lastError });
      }
      await sleep(200);
    }
    const remaining = [...deferred, ...queue];
    await setState("seatgeek:crawl", remaining.length ? { countries: countries.join(","), queue: remaining } : undefined, 7 * 86400);
    if (!remaining.length) await setState("seatgeek:complete", Date.now());
    const partial = !!resume || remaining.length > 0;
    if (remaining.length) lastError = `${remaining.length} date window(s) left; the next run continues from there`;
    const batch = normalizeSeatGeek([...raw.values()], syncedAt);
    return {
      batch,
      run: { imported: batch.events.length, updated: 0, failures, rateLimited: false, ok: batch.events.length > 0 || failures === 0, partial, finishedAt: new Date().toISOString(), error: lastError || undefined },
    };
  },
};
