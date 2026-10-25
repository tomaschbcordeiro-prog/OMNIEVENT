import { groupOf } from "../categories";
import { getCountry, slugify } from "../destinations";
import type { EventStatus, OmniEvent, Participant, ParticipantKind, TicketOffer, Venue } from "../types";
import { ProviderError, type ProviderAdapter, type ProviderBatch, type SyncContext } from "./types";
import { envList, nearestCityId, sleep } from "./common";
import { getState, setState } from "../shared-cache";

/**
 * Ticketmaster Discovery API v2 adapter (https://developer.ticketmaster.com).
 *
 * - Requires TICKETMASTER_API_KEY (free developer key). Without it the adapter is disabled.
 * - Coverage: Ticketmaster markets (US, CA, MX, UK, IE, much of Europe, AU, NZ and more).
 * - Quota (default developer tier): 5,000 calls/day, 5 req/s; deep paging limited to 1,000 items
 *   per query, so the full catalogue is read in date windows small enough to fit (crawlCatalogue).
 * - Terms: attribution required; purchase links must go to Ticketmaster. Prices from
 *   `priceRanges` are advertised ranges, NOT verified totals; we never mark fees as included
 *   unless the price type says so.
 */

const BASE = "https://app.ticketmaster.com/discovery/v2";
// Markets with Discovery API listings. Checking a country with none costs one request.
const DEFAULT_COUNTRIES = [
  "US", "CA", "MX", "GB", "IE", "ES", "PT", "FR", "DE", "NL", "BE", "LU", "IT", "AT", "CH", "DK", "SE", "NO", "FI", "IS",
  "PL", "CZ", "SK", "HU", "SI", "HR", "RO", "BG", "GR", "CY", "MT", "EE", "LV", "LT", "TR", "AE", "ZA", "AU", "NZ",
  "JP", "KR", "SG", "HK", "TW", "IN", "BR", "AR", "CL", "CO", "PE",
];

// ---- Raw API shapes (only the fields we use) ----
interface TmImage { url: string; width?: number; ratio?: string }
interface TmClass { segment?: { name?: string }; genre?: { name?: string }; subGenre?: { name?: string } }
interface TmVenue {
  id: string; name?: string; url?: string; timezone?: string;
  city?: { name?: string }; state?: { name?: string }; country?: { name?: string; countryCode?: string };
  address?: { line1?: string }; location?: { latitude?: string; longitude?: string };
  accessibleSeatingDetail?: string;
}
interface TmAttraction { id: string; name: string; url?: string; images?: TmImage[]; classifications?: TmClass[] }
export interface TmEvent {
  id: string; name: string; url?: string; info?: string; pleaseNote?: string; images?: TmImage[];
  dates?: { start?: { localDate?: string; localTime?: string; dateTime?: string; dateTBD?: boolean; timeTBA?: boolean }; end?: { dateTime?: string }; timezone?: string; status?: { code?: string } };
  sales?: { public?: { startDateTime?: string } };
  classifications?: TmClass[];
  priceRanges?: { type?: string; currency?: string; min?: number; max?: number }[];
  ageRestrictions?: { legalAgeEnforced?: boolean };
  accessibility?: { info?: string };
  _embedded?: { venues?: TmVenue[]; attractions?: TmAttraction[] };
}

const GENRE_MAP: Record<string, string> = {
  rock: "rock-metal", metal: "rock-metal", classical: "classical", jazz: "jazz", "hip-hop/rap": "hip-hop",
  pop: "pop", "dance/electronic": "electronic", electronic: "electronic", alternative: "indie", folk: "acoustic",
  soccer: "football", basketball: "basketball", football: "american-football", baseball: "baseball", hockey: "ice-hockey",
  tennis: "tennis", motorsports: "motorsport", "motorsports/racing": "motorsport", boxing: "combat", "mixed martial arts": "combat",
  wrestling: "combat", rugby: "rugby", cricket: "cricket", golf: "golf", volleyball: "volleyball", cycling: "cycling",
  athletics: "athletics", "track & field": "athletics", swimming: "swimming", skiing: "winter-sports",
  theatre: "plays", musical: "musicals", comedy: "stand-up", dance: "dance", opera: "opera", "magic & illusion": "magic",
  "circus & specialty acts": "circus", "children's theatre": "kids-theatre", "fine art": "art-exhibitions", "cabaret": "cabaret",
  "spoken word": "spoken-word", "fairs & festivals": "festivals", "food & drink": "food-drink", family: "family-shows",
};
const SEGMENT_MAP: Record<string, string> = {
  music: "concerts", sports: "sports", "arts & theatre": "theatre", film: "cinema", miscellaneous: "other",
};

export function mapCategory(c?: TmClass): string {
  const genre = c?.genre?.name?.toLowerCase();
  const sub = c?.subGenre?.name?.toLowerCase();
  const seg = c?.segment?.name?.toLowerCase();
  return (sub && GENRE_MAP[sub]) || (genre && GENRE_MAP[genre]) || (seg && SEGMENT_MAP[seg]) || "other";
}

export function mapStatus(code?: string): EventStatus {
  switch (code) {
    case "onsale": return "on_sale";
    case "offsale": return "scheduled";
    case "cancelled":
    case "canceled": return "cancelled";
    case "postponed": return "postponed";
    case "rescheduled": return "rescheduled";
    default: return "unknown";
  }
}

function bestImage(imgs?: TmImage[]): string | undefined {
  if (!imgs?.length) return undefined;
  const wide = imgs.filter((i) => i.ratio === "16_9").sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const ok = wide.find((i) => (i.width ?? 0) <= 1200) ?? wide[0] ?? imgs[0];
  return ok.url;
}

/** Pure mapping function — unit-tested with fixtures in tests/ticketmaster.test.ts. */
export function normalizeTmEvents(raw: TmEvent[], syncedAt: string): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const participants = new Map<string, Participant>();
  const offers: TicketOffer[] = [];

  for (const e of raw) {
    const v = e._embedded?.venues?.[0];
    const lat = Number(v?.location?.latitude);
    const lng = Number(v?.location?.longitude);
    const start = e.dates?.start?.dateTime;
    // Skip records we cannot place on the globe or in time — never guess coordinates or dates.
    if (!v || !Number.isFinite(lat) || !Number.isFinite(lng) || !start) continue;
    const tz = e.dates?.timezone || v.timezone || "UTC";
    const cc = v.country?.countryCode ?? "";
    const venueId = `tm-v-${v.id}`;
    if (!venues.has(venueId)) {
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${v.name ?? "venue"}-${v.id}`),
        name: v.name ?? "Venue",
        address: v.address?.line1,
        city: v.city?.name ?? "",
        cityId: nearestCityId(lat, lng),
        region: v.state?.name,
        country: v.country?.name ?? getCountry(cc)?.name ?? cc,
        countryCode: cc,
        lat,
        lng,
        timeZone: tz,
        url: v.url,
        accessibility: v.accessibleSeatingDetail ? [v.accessibleSeatingDetail] : undefined,
        provenance: { provider: "ticketmaster", externalId: v.id, sourceUrl: v.url, lastSyncedAt: syncedAt, isDemo: false },
      });
    }

    const cat = mapCategory(e.classifications?.[0]);
    const group = groupOf(cat);
    const people = (e._embedded?.attractions ?? []).map((a, i) => {
      const kind: ParticipantKind = group === "sports" ? "team" : group === "conferences" ? "speaker" : group === "theatre" ? "production" : "artist";
      const id = `tm-a-${a.id}`;
      if (!participants.has(id))
        participants.set(id, {
          id,
          slug: slugify(`${a.name}-${a.id}`),
          name: a.name,
          kind,
          url: a.url,
          imageUrl: bestImage(a.images),
          provenance: { provider: "ticketmaster", externalId: a.id, sourceUrl: a.url, lastSyncedAt: syncedAt, isDemo: false },
        });
      // Ticketmaster does not reliably mark home/away, so we use a neutral role.
      return { participantId: id, role: group === "sports" ? ("team" as const) : i === 0 ? ("headliner" as const) : ("support" as const), order: i };
    });

    const status = mapStatus(e.dates?.status?.code);
    const id = `tm-e-${e.id}`;
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${e.name}-${e.id}`),
      title: e.name,
      description: [e.info, e.pleaseNote].filter(Boolean).join("\n\n") || undefined,
      categorySlug: cat,
      groupSlug: group,
      eventType: "single",
      venueId,
      start,
      end: e.dates?.end?.dateTime,
      timeZone: tz,
      status,
      ticketAccess: "ticketed",
      isFree: false,
      registrationRequired: false,
      online: false,
      familyFriendly: cat === "family-shows" || cat === "kids-theatre",
      ageRestriction: e.ageRestrictions?.legalAgeEnforced ? { note: "Legal age restrictions are enforced (see provider for details)." } : undefined,
      accessibility: e.accessibility?.info ? [e.accessibility.info] : undefined,
      officialUrl: e.url,
      imageUrl: bestImage(e.images),
      participants: people,
      sports: group === "sports" ? { sport: e.classifications?.[0]?.genre?.name ?? "Sport", league: e.classifications?.[0]?.subGenre?.name } : undefined,
      announcedAt: e.sales?.public?.startDateTime,
      provenance: { provider: "ticketmaster", externalId: e.id, sourceUrl: e.url, lastSyncedAt: syncedAt, lastVerifiedAt: syncedAt, isDemo: false },
    });

    const priced = (e.priceRanges ?? []).filter((pr) => pr.min != null && pr.currency);
    // Most Discovery API events carry no price ranges. We still list the official
    // purchase link, with no price, rather than leaving the event without a ticket option.
    if (!priced.length && e.url && status !== "cancelled") {
      offers.push({
        id: `${id}-link`,
        eventId: id,
        provider: "Ticketmaster",
        providerType: "primary",
        providerEventId: e.id,
        ticketCategory: "standard",
        label: "Prices shown on Ticketmaster",
        currency: "",
        availability: status === "on_sale" ? "unknown" : "not_on_sale",
        purchaseUrl: e.url,
        isDemo: false,
      });
    }
    priced.forEach((pr, i) => {
      const inclFees = /including fees/i.test(pr.type ?? "");
      offers.push({
        id: `${id}-pr${i}`,
        eventId: id,
        provider: "Ticketmaster",
        providerType: "primary",
        providerEventId: e.id,
        ticketCategory: "standard",
        label: pr.type,
        basePrice: pr.min,
        maxPrice: pr.max,
        feesIncluded: inclFees ? true : undefined,
        totalPrice: inclFees ? pr.min : undefined,
        currency: pr.currency!,
        availability: status === "cancelled" ? "not_on_sale" : status === "on_sale" ? "unknown" : "not_on_sale",
        purchaseUrl: e.url,
        priceObservedAt: syncedAt,
        isDemo: false,
      });
    });
  }
  return { events, venues: [...venues.values()], participants: [...participants.values()], offers };
}

const CACHE_SECONDS = Number(process.env.TICKETMASTER_CACHE_HOURS ?? 72) * 3600;

async function tmFetch(path: string, params: Record<string, string>, ctx: SyncContext, attempt = 0): Promise<unknown> {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) throw new ProviderError("ticketmaster", "TICKETMASTER_API_KEY not configured");
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", key);
  // Cached in the platform data cache: the crawl plan is the same all month, so other server
  // instances and later refreshes reuse these answers instead of spending the
  // 5,000-calls-a-day quota. Only 200s are cached, and an entry past its age keeps being
  // served while it is refreshed, so a used-up quota never empties the map.
  // The URL (with the key) never leaves the server.
  const res = await fetch(url, { signal: ctx.signal, next: { revalidate: CACHE_SECONDS } } as RequestInit);
  if (res.status === 429) {
    // Quota responses say when the allowance resets (epoch ms). Retrying before then
    // only spends requests, so stop and report the time instead.
    // A 429 is either the 5-per-second spike limit (retry in a moment) or the daily quota
    // (resets hours away). Only the latter stops the crawl.
    const reset = Number(res.headers.get("rate-limit-reset"));
    if (reset > Date.now() + 5 * 60000) {
      const when = reset > 0 ? `; allowance resets ${new Date(reset).toISOString().slice(0, 16).replace("T", " ")} UTC` : "";
      throw new ProviderError("ticketmaster", `daily quota used up${when}`, 429, true);
    }
    if (attempt >= 3) throw new ProviderError("ticketmaster", "busy (per-second limit)", 429, false);
    const wait = Number(res.headers.get("retry-after") ?? 1.5) * 1000 * (attempt + 1) + Math.random() * 500;
    ctx.log("ticketmaster rate limited, backing off", { wait });
    await sleep(wait);
    return tmFetch(path, params, ctx, attempt + 1);
  }
  if (!res.ok) throw new ProviderError("ticketmaster", `HTTP ${res.status}`, res.status);
  return res.json();
}

type TmPage = { _embedded?: { events?: TmEvent[] }; page?: { totalElements?: number; totalPages?: number } };
type FetchPage = (params: Record<string, string>) => Promise<TmPage>;

const HOUR = 3600000;
const PAGE_SIZE = 200;
/** The Discovery API serves at most 1,000 results per query (size × page < 1,000). */
const MAX_PER_QUERY = 1000;
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Reads the complete catalogue for each country. A query can only reach 1,000 results,
 * so each country's calendar is split into date windows: when a window holds more than
 * 1,000 events it is halved (on whole hours) until every piece fits, then each piece is
 * read page by page. The plan only depends on the day, so repeat runs make identical
 * requests and are answered from the data cache.
 */
export type CrawlTask = { cc: string; start: number; end: number; page: number };

export async function crawlCatalogue(
  fetchPage: FetchPage,
  countries: string[],
  { from, to, maxCalls, onError, onEvents, resume }: { from: number; to: number; maxCalls: number; onError?: (err: unknown, what: string) => boolean; onEvents: (events: TmEvent[]) => void; resume?: CrawlTask[] },
): Promise<{ calls: number; truncated: number; complete: boolean; remaining: CrawlTask[] }> {
  let calls = 0;
  let truncated = 0;
  let stopped = false;
  type Task = CrawlTask;
  // A crawl too big for one run continues from where the last run stopped.
  const queue: Task[] = resume?.length ? [...resume] : countries.map((cc) => ({ cc, start: from, end: to, page: 0 }));
  const deferred: Task[] = [];
  const call = async (t: Task) => {
    calls++;
    return fetchPage({ countryCode: t.cc, startDateTime: iso(t.start), endDateTime: iso(t.end), size: String(PAGE_SIZE), page: String(t.page), sort: "date,asc" });
  };
  const worker = async () => {
    while (queue.length && !stopped) {
      if (calls >= maxCalls) {
        stopped = true;
        break;
      }
      const t = queue.shift()!;
      let json: TmPage;
      try {
        json = await call(t);
      } catch (err) {
        deferred.push(t); // retried next run
        if (onError?.(err, `${t.cc} ${iso(t.start)} p${t.page}`) === false) stopped = true;
        continue;
      }
      const total = json.page?.totalElements ?? 0;
      if (t.page === 0 && total > MAX_PER_QUERY && t.end - t.start > HOUR) {
        // Too many for one query: halve the window on a whole hour and try each half.
        const mid = t.start + Math.max(1, Math.floor((t.end - t.start) / 2 / HOUR)) * HOUR;
        queue.unshift({ ...t, start: t.start, end: mid }, { ...t, start: mid, end: t.end });
        continue;
      }
      onEvents(json._embedded?.events ?? []);
      if (t.page === 0) {
        if (total > MAX_PER_QUERY) truncated += total - MAX_PER_QUERY; // over 1,000 events in one hour
        const pages = Math.min(Math.ceil(Math.min(total, MAX_PER_QUERY) / PAGE_SIZE), MAX_PER_QUERY / PAGE_SIZE);
        for (let p = pages - 1; p >= 1; p--) queue.unshift({ ...t, page: p });
      }
    }
  };
  // Three requests in flight keeps one server under the 5-per-second limit with room for others.
  await Promise.all(Array.from({ length: 3 }, worker));
  const remaining = [...deferred, ...queue];
  return { calls, truncated, complete: !remaining.length, remaining };
}

export const ticketmasterProvider: ProviderAdapter = {
  id: "ticketmaster",
  name: "Ticketmaster Discovery API",
  isDemo: false,
  coverage: "Every scheduled event Ticketmaster lists in its markets (North America, much of Europe, Australia/NZ, Mexico and more), up to two years ahead.",
  attribution: "Event data and ticket links provided by Ticketmaster.",
  isConfigured: () => !!process.env.TICKETMASTER_API_KEY,
  // Re-assembles from the data cache; new API calls happen once a day (see tmFetch).
  refreshIntervalMs: Number(process.env.TICKETMASTER_REFRESH_MINUTES ?? 360) * 60000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const countries = envList("TICKETMASTER_COUNTRIES", DEFAULT_COUNTRIES);
    let failures = 0;
    let lastError = "";
    let rateLimited = false;
    let notLoaded = 0;
    // Month-aligned window so every instance and every run asks identical questions all
    // month, and the cached answers build up across days instead of starting over daily.
    const now = new Date();
    const from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const months = Math.ceil(Number(process.env.TICKETMASTER_DAYS_AHEAD ?? 730) / 30.4) + 1;
    const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1);
    // Only answers that really came from Ticketmaster (not the data cache) use the quota.
    // Per run and per server instance; answers are cached for the day, so each run continues
    // where earlier runs (on any instance) stopped.
    // Four refreshes a day stay under the 5,000-a-day quota.
    const budget = Number(process.env.TICKETMASTER_MAX_CALLS ?? 1200);
    let networkCalls = 0;
    const fetchPage: FetchPage = async (params) => {
      if (networkCalls >= budget) throw new ProviderError("ticketmaster", `daily request budget (${budget}) reached`, 429, true);
      const t0 = Date.now();
      const json = (await tmFetch("/events.json", params, ctx)) as TmPage;
      const elapsed = Date.now() - t0;
      if (elapsed > 60) {
        networkCalls++;
        await sleep(Math.max(0, 850 - elapsed)); // stay under 5 req/s; cache hits skip the wait
      }
      return json;
    };
    // Pages are converted as they arrive, so memory holds compact records, not raw JSON.
    const cutoff = Date.now() - 6 * 3600000;
    const events = new Map<string, OmniEvent>();
    const venues = new Map<string, Venue>();
    const participants = new Map<string, Participant>();
    const offers = new Map<string, TicketOffer>();
    const onEvents = (list: TmEvent[]) => {
      const fresh = list.filter((r) => !(r.dates?.start?.dateTime && Date.parse(r.dates.start.dateTime) < cutoff));
      const b = normalizeTmEvents(fresh, syncedAt);
      for (const e of b.events) events.set(e.id, e);
      for (const v of b.venues) venues.set(v.id, v);
      for (const x of b.participants) participants.set(x.id, x);
      for (const o of b.offers) offers.set(o.id, o);
      ctx.onProgress?.({ events: [...events.values()], venues: [...venues.values()], participants: [...participants.values()], offers: [...offers.values()] });
    };
    // Where the previous run stopped, if it was reading the same plan (same month).
    const saved = await getState<{ from: number; to: number; countries: string; queue: CrawlTask[] }>("ticketmaster:crawl");
    const resume = saved && saved.from === from && saved.to === to && saved.countries === countries.join(",") ? saved.queue : undefined;
    const crawl = await crawlCatalogue(fetchPage, countries, {
      resume,
      onEvents,
      from,
      to,
      maxCalls: 20000,
      onError: (err, what) => {
        // Once the daily quota is used up, uncached windows answer 429 at no cost, so keep
        // going: everything already in the cache still loads.
        if (err instanceof ProviderError && err.rateLimited && /quota/.test(err.message)) {
          rateLimited = true;
          notLoaded++;
          if (!lastError) lastError = String(err).slice(0, 160);
          return true;
        }
        failures++;
        lastError = String(err).slice(0, 160);
        ctx.log("ticketmaster page failed", { what, err: lastError });
        if (err instanceof ProviderError && err.rateLimited) rateLimited = true;
        return !rateLimited && failures < 25;
      },
    });
    ctx.log("ticketmaster crawl", { calls: crawl.calls, networkCalls, events: events.size, complete: crawl.complete, truncated: crawl.truncated, resumed: !!resume });
    await setState("ticketmaster:crawl", crawl.remaining.length ? { from, to, countries: countries.join(","), queue: crawl.remaining } : undefined, 40 * 86400);
    const batch: ProviderBatch = { events: [...events.values()], venues: [...venues.values()], participants: [...participants.values()], offers: [...offers.values()] };
    const notes = [
      notLoaded ? `${notLoaded} date window(s) wait for the daily quota (${lastError.replace(/^.*?daily quota used up;?\s*/, "")})` : "",
      failures ? `${failures} request(s) failed (last: ${lastError})` : "",
      !crawl.complete ? `${crawl.remaining.length} date window(s) left; the next run continues from there (${networkCalls} requests to Ticketmaster this run)` : "",
      crawl.truncated ? `${crawl.truncated} events in very busy hours not reachable` : "",
    ].filter(Boolean);
    return {
      batch,
      run: { imported: batch.events.length, updated: 0, failures, rateLimited, ok: batch.events.length > 0 || failures === 0, partial: !!resume || !crawl.complete, finishedAt: new Date().toISOString(), error: notes.length ? notes.join("; ") : undefined },
    };
  },
  async fetchEvent(externalId) {
    const json = (await tmFetch(`/events/${encodeURIComponent(externalId)}.json`, {}, { maxEvents: 1, log: () => {} })) as TmEvent;
    return normalizeTmEvents([json], new Date().toISOString());
  },
};
