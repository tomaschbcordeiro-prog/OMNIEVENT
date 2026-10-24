import { groupOf } from "../categories";
import { getCountry, slugify } from "../destinations";
import type { OmniEvent, Participant, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { citiesIn, envList, fetchJson, hueOf, nearestCityId, parseAmount, parseLocal, plainText, sleep } from "./common";

/**
 * Skiddle Events API (https://github.com/Skiddle/web-api).
 *
 * - Requires SKIDDLE_API_KEY (free, from skiddle.com/api/join.php).
 * - Coverage: the UK and Ireland — clubs, gigs, festivals, comedy, theatre, exhibitions.
 * - Skiddle is a primary ticket seller. `ticketpricing.minPrice` is the cheapest advertised
 *   price; we never mark fees as included.
 */

const BASE = "https://www.skiddle.com/api/v1/events/search/";
const DEFAULT_COUNTRIES = ["GB", "IE"];
// Skiddle is strongest in regional UK cities, beyond the ones on our destination list.
const EXTRA_CITIES = [
  { id: "birmingham", lat: 52.4862, lng: -1.8904 }, { id: "leeds", lat: 53.8008, lng: -1.5491 },
  { id: "liverpool", lat: 53.4084, lng: -2.9916 }, { id: "glasgow", lat: 55.8642, lng: -4.2518 },
  { id: "bristol", lat: 51.4545, lng: -2.5879 }, { id: "newcastle", lat: 54.9783, lng: -1.6178 },
  { id: "sheffield", lat: 53.3811, lng: -1.4701 }, { id: "nottingham", lat: 52.9548, lng: -1.1581 },
  { id: "cardiff", lat: 51.4816, lng: -3.1791 }, { id: "belfast", lat: 54.5973, lng: -5.9301 },
  { id: "brighton", lat: 50.8225, lng: -0.1372 }, { id: "cork", lat: 51.8985, lng: -8.4756 },
];

export interface SkEvent {
  id: string | number;
  EventCode?: string;
  eventname?: string;
  cancelled?: string | number | boolean;
  imageurl?: string;
  largeimageurl?: string;
  link?: string;
  date?: string;
  startdate?: string;
  enddate?: string;
  description?: string;
  openingtimes?: { doorsopen?: string; doorsclose?: string; lastentry?: string };
  minage?: string | number;
  entryprice?: string;
  tickets?: boolean;
  ticketpricing?: { minPrice?: number | string; maxPrice?: number | string };
  venue?: { id?: string | number; name?: string; address?: string; town?: string; postcode?: string; country?: string; latitude?: number | string; longitude?: number | string };
  artists?: { artistid?: string | number; name?: string; image?: string }[];
  genres?: { name?: string }[];
}

const CODE_MAP: Record<string, string> = {
  CLUB: "club-nights", LIVE: "concerts", FEST: "music-festivals", COMEDY: "stand-up", THEATRE: "plays",
  EXHIB: "art-exhibitions", KIDS: "family-shows", BARPUB: "nightlife", LGB: "nightlife", SPORT: "sports",
  ARTS: "culture", DATE: "nightlife",
};
const GENRE_MAP: Record<string, string> = {
  techno: "electronic", house: "electronic", "drum & bass": "electronic", trance: "electronic", electronic: "electronic",
  jazz: "jazz", rock: "rock-metal", metal: "rock-metal", indie: "indie", "hip hop": "hip-hop", rap: "hip-hop",
  pop: "pop", classical: "classical", folk: "acoustic", tribute: "tribute",
};

export function mapSkiddle(code?: string, genres?: { name?: string }[]): string {
  if (code === "LIVE" || code === "CLUB") {
    for (const g of genres ?? []) {
      const k = g.name?.toLowerCase();
      if (k && GENRE_MAP[k]) return GENRE_MAP[k];
    }
  }
  return (code && CODE_MAP[code.toUpperCase()]) || "other";
}

function tzFor(cc: string) {
  return cc === "IE" ? "Europe/Dublin" : "Europe/London";
}

function countryCode(name?: string): string {
  const n = (name ?? "").toLowerCase();
  if (/ireland|^ie$/.test(n) && !/northern/.test(n)) return "IE";
  return "GB";
}

/** Pure mapping function — unit-tested with fixtures in tests/sources.test.ts. */
export function normalizeSkiddle(raw: SkEvent[], syncedAt: string): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const participants = new Map<string, Participant>();
  const offers: TicketOffer[] = [];
  const seen = new Set<string>();

  for (const e of raw) {
    const extId = String(e.id);
    if (seen.has(extId)) continue;
    seen.add(extId);
    const v = e.venue;
    const lat = Number(v?.latitude);
    const lng = Number(v?.longitude);
    if (!v || !e.eventname || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    const cc = countryCode(v.country);
    const tz = tzFor(cc);
    // `startdate` normally carries an offset; otherwise combine the date with doors-open time.
    const start = parseLocal(e.startdate, tz) ?? parseLocal(e.date && `${e.date} ${e.openingtimes?.doorsopen ?? "00:00"}`, tz);
    if (start === undefined) continue;
    let end = parseLocal(e.enddate, tz);
    if (end !== undefined && end <= start) end = undefined;

    const venueId = `sk-v-${v.id ?? slugify(`${v.name}-${lat}-${lng}`)}`;
    if (!venues.has(venueId)) {
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${v.name ?? "venue"}-sk${v.id ?? ""}`),
        name: v.name ?? "Venue",
        address: [v.address, v.postcode].filter(Boolean).join(", ") || undefined,
        city: v.town ?? "",
        cityId: nearestCityId(lat, lng),
        country: getCountry(cc)?.name ?? cc,
        countryCode: cc,
        lat,
        lng,
        timeZone: tz,
        provenance: { provider: "skiddle", externalId: String(v.id ?? venueId), lastSyncedAt: syncedAt, isDemo: false },
      });
    }

    const cat = mapSkiddle(e.EventCode, e.genres);
    const group = groupOf(cat);
    const people = (e.artists ?? []).filter((a) => a.name).map((a, i) => {
      const id = `sk-a-${a.artistid ?? slugify(a.name!)}`;
      if (!participants.has(id))
        participants.set(id, {
          id,
          slug: slugify(`${a.name}-sk${a.artistid ?? ""}`),
          name: a.name!,
          kind: group === "comedy" ? "performer" : "artist",
          imageUrl: a.image || undefined,
          provenance: { provider: "skiddle", externalId: String(a.artistid ?? a.name), lastSyncedAt: syncedAt, isDemo: false },
        });
      return { participantId: id, role: i === 0 ? ("headliner" as const) : ("support" as const), order: i };
    });

    const cancelled = e.cancelled === true || e.cancelled === 1 || e.cancelled === "1";
    const min = parseAmount(String(e.ticketpricing?.minPrice ?? "")) ?? parseAmount(e.entryprice);
    const max = parseAmount(String(e.ticketpricing?.maxPrice ?? ""));
    const free = /^free/i.test(e.entryprice ?? "") || (min === 0 && !max);
    const minAge = Number(e.minage);
    const id = `sk-e-${extId}`;
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${e.eventname}-sk${extId}`),
      title: e.eventname.trim(),
      description: plainText(e.description),
      categorySlug: cat,
      groupSlug: group,
      eventType: end !== undefined && end - start > 26 * 3600000 ? "multi_day" : "single",
      venueId,
      start: new Date(start).toISOString(),
      end: end !== undefined ? new Date(end).toISOString() : undefined,
      timeZone: tz,
      status: cancelled ? "cancelled" : free ? "free_entry" : e.tickets ? "on_sale" : "scheduled",
      ticketAccess: free ? "free" : "ticketed",
      isFree: free,
      registrationRequired: false,
      online: false,
      familyFriendly: e.EventCode === "KIDS",
      ageRestriction: minAge > 0 ? { minAge } : undefined,
      officialUrl: e.link,
      imageUrl: e.largeimageurl || e.imageurl || undefined,
      posterHue: hueOf(extId),
      participants: people,
      provenance: { provider: "skiddle", externalId: extId, sourceUrl: e.link, lastSyncedAt: syncedAt, lastVerifiedAt: syncedAt, isDemo: false },
    });
    if (e.link && !cancelled) {
      const priced = min !== undefined && !free;
      offers.push({
        id: `${id}-sk`,
        eventId: id,
        provider: "Skiddle",
        providerType: "primary",
        providerEventId: extId,
        ticketCategory: "standard",
        label: free ? "Free entry" : priced ? "Tickets on Skiddle" : "Prices shown on Skiddle",
        basePrice: priced ? min : undefined,
        maxPrice: priced && max !== undefined && max > min! ? max : undefined,
        currency: priced ? (cc === "IE" ? "EUR" : "GBP") : "",
        availability: e.tickets === false ? "not_on_sale" : "unknown",
        purchaseUrl: e.link,
        priceObservedAt: priced ? syncedAt : undefined,
        isDemo: false,
      });
    }
  }
  return { events, venues: [...venues.values()], participants: [...participants.values()], offers };
}

export const skiddleProvider: ProviderAdapter = {
  id: "skiddle",
  name: "Skiddle Events API",
  isDemo: false,
  coverage: "Club nights, gigs, festivals, comedy and more across the UK and Ireland.",
  attribution: "Event data and ticket links provided by Skiddle.",
  isConfigured: () => !!process.env.SKIDDLE_API_KEY,
  refreshIntervalMs: Number(process.env.SKIDDLE_REFRESH_MINUTES ?? 180) * 60000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const raw: SkEvent[] = [];
    let failures = 0;
    let lastError = "";
    const countries = envList("SKIDDLE_COUNTRIES", DEFAULT_COUNTRIES);
    const cities = [...citiesIn(countries), ...(countries.includes("GB") ? EXTRA_CITIES : [])];
    const pages = Math.max(1, Number(process.env.SKIDDLE_CITY_PAGES ?? 3));
    for (const c of cities) {
      for (let page = 0; page < pages && raw.length < ctx.maxEvents; page++) {
        const url = new URL(BASE);
        url.searchParams.set("api_key", process.env.SKIDDLE_API_KEY!);
        url.searchParams.set("latitude", String(c.lat));
        url.searchParams.set("longitude", String(c.lng));
        url.searchParams.set("radius", "30"); // miles
        url.searchParams.set("limit", "100");
        url.searchParams.set("offset", String(page * 100));
        url.searchParams.set("order", "date");
        url.searchParams.set("description", "1");
        try {
          const json = (await fetchJson("skiddle", url, ctx)) as { error?: number | string; totalcount?: number | string; results?: SkEvent[] };
          if (json.error && Number(json.error) !== 0) throw new Error(`Skiddle error ${json.error}`);
          const list = json.results ?? [];
          raw.push(...list);
          if (list.length < 100 || (page + 1) * 100 >= Number(json.totalcount ?? 0)) break;
        } catch (err) {
          failures++;
            lastError = String(err).slice(0, 160);
          ctx.log("skiddle page failed", { city: c.id, page, err: String(err) });
          break;
        }
        await sleep(250);
      }
      if (failures >= 5) break;
    }
    const batch = normalizeSkiddle(raw, syncedAt);
    return {
      batch,
      run: { imported: batch.events.length, updated: 0, failures, rateLimited: false, ok: batch.events.length > 0 || failures === 0, finishedAt: new Date().toISOString(), error: failures ? `${failures} page request(s) failed (last: ${lastError})` : undefined },
    };
  },
};
