import { groupOf } from "../categories";
import { getCountry, CITIES, slugify } from "../destinations";
import { haversineKm } from "../geo";
import type { EventStatus, OmniEvent, Participant, ParticipantKind, TicketOffer, Venue } from "../types";
import { ProviderError, type ProviderAdapter, type ProviderBatch, type SyncContext } from "./types";

/**
 * Ticketmaster Discovery API v2 adapter (https://developer.ticketmaster.com).
 *
 * - Requires TICKETMASTER_API_KEY (free developer key). Without it the adapter is disabled.
 * - Coverage: Ticketmaster markets (US, CA, MX, UK, IE, much of Europe, AU, NZ and more).
 * - Quota (default developer tier): 5,000 calls/day, 5 req/s; deep paging limited to 1,000 items
 *   per query, so we page per country to widen coverage.
 * - Terms: attribution required; purchase links must go to Ticketmaster. Prices from
 *   `priceRanges` are advertised ranges, NOT verified totals; we never mark fees as included
 *   unless the price type says so.
 */

const BASE = "https://app.ticketmaster.com/discovery/v2";
const DEFAULT_COUNTRIES = ["US", "CA", "GB", "IE", "ES", "PT", "FR", "DE", "NL", "BE", "IT", "AT", "CH", "DK", "SE", "NO", "FI", "PL", "CZ", "MX", "AU", "NZ"];

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

function nearestCityId(lat: number, lng: number): string | undefined {
  let best: { id: string; d: number } | undefined;
  for (const c of CITIES) {
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (!best || d < best.d) best = { id: c.id, d };
  }
  return best && best.d < 60 ? best.id : undefined;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tmFetch(path: string, params: Record<string, string>, ctx: SyncContext, attempt = 0): Promise<unknown> {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) throw new ProviderError("ticketmaster", "TICKETMASTER_API_KEY not configured");
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", key);
  // Cached in the platform data cache for an hour so cold server instances don't
  // re-download everything (and don't spend API quota). The key excludes nothing
  // secret-dependent beyond the URL, which never leaves the server.
  const res = await fetch(url, { signal: ctx.signal, next: { revalidate: 3600 } } as RequestInit);
  if (res.status === 429) {
    if (attempt >= 3) throw new ProviderError("ticketmaster", "rate limited", 429, true);
    const wait = Number(res.headers.get("retry-after") ?? 2) * 1000 * (attempt + 1);
    ctx.log("ticketmaster rate limited, backing off", { wait });
    await sleep(wait);
    return tmFetch(path, params, ctx, attempt + 1);
  }
  if (!res.ok) throw new ProviderError("ticketmaster", `HTTP ${res.status}`, res.status);
  return res.json();
}

export const ticketmasterProvider: ProviderAdapter = {
  id: "ticketmaster",
  name: "Ticketmaster Discovery API",
  isDemo: false,
  coverage: "Events sold through Ticketmaster in its supported markets (North America, much of Europe, Australia/NZ, Mexico).",
  attribution: "Event data and ticket links provided by Ticketmaster.",
  isConfigured: () => !!process.env.TICKETMASTER_API_KEY,
  refreshIntervalMs: Number(process.env.TICKETMASTER_REFRESH_MINUTES ?? 60) * 60000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const countries = (process.env.TICKETMASTER_COUNTRIES?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)) ?? DEFAULT_COUNTRIES;
    const raw: TmEvent[] = [];
    let failures = 0;
    let rateLimited = false;
    const perCountry = Math.max(200, Math.floor(ctx.maxEvents / countries.length));
    // Round the window start to the hour so identical requests hit the data cache.
    const windowStart = new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString().replace(/\.\d{3}Z$/, "Z");
    // A small worker pool: ~4 requests in flight, paced to stay under 5 req/s.
    const queue = [...countries];
    const worker = async () => {
      while (queue.length && !rateLimited) {
        const cc = queue.shift()!;
        for (let page = 0; page * 200 < Math.min(perCountry, 1000); page++) {
          const t0 = Date.now();
          try {
            const json = (await tmFetch("/events.json", {
              countryCode: cc,
              size: "200",
              page: String(page),
              sort: "date,asc",
              startDateTime: windowStart,
            }, ctx)) as { _embedded?: { events?: TmEvent[] }; page?: { totalPages?: number } };
            const list = json._embedded?.events ?? [];
            raw.push(...list);
            const elapsed = Date.now() - t0;
            if (elapsed > 60) await sleep(Math.max(0, 850 - elapsed)); // cache hits skip the wait
            if (!list.length || page + 1 >= (json.page?.totalPages ?? 0)) break;
          } catch (err) {
            failures++;
            if (err instanceof ProviderError && err.rateLimited) rateLimited = true;
            ctx.log("ticketmaster page failed", { cc, page, err: String(err) });
            break;
          }
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    // Past events can appear when the window start was rounded down.
    const cutoff = Date.now() - 6 * 3600000;
    const seen = new Set<string>();
    for (let i = raw.length - 1; i >= 0; i--) {
      const r = raw[i];
      if (seen.has(r.id) || (r.dates?.start?.dateTime && Date.parse(r.dates.start.dateTime) < cutoff)) raw.splice(i, 1);
      else seen.add(r.id);
    }
    const batch = normalizeTmEvents(raw, syncedAt);
    return {
      batch,
      run: { imported: batch.events.length, updated: 0, failures, rateLimited, ok: failures === 0 || batch.events.length > 0, finishedAt: new Date().toISOString(), error: failures ? `${failures} page request(s) failed` : undefined },
    };
  },
  async fetchEvent(externalId) {
    const json = (await tmFetch(`/events/${encodeURIComponent(externalId)}.json`, {}, { maxEvents: 1, log: () => {} })) as TmEvent;
    return normalizeTmEvents([json], new Date().toISOString());
  },
};
