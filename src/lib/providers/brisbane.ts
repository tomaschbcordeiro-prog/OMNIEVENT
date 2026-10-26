import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, keyOf, nearestCityId, parseAmount, plainText } from "./common";
import VENUES from "./data/brisbane-venues.json";

/**
 * Brisbane City Council's public events calendar (the Trumba feed behind brisbane.qld.gov.au
 * "What's on"): libraries, parks, GOLD 'n' Kids programmes, markets, Botanic Gardens walks,
 * the Planetarium, Museum of Brisbane. No key needed. The feed answers at most 2,000 sessions
 * per request, so it is read month by month for the coming year.
 *
 * - Most venues carry their coordinates in a map link; the others were located from their
 *   address (data/brisbane-venues.json, scripts/fetch-brisbane-venues.mjs). Events at venues
 *   we couldn't place are skipped.
 * - Sessions of the same activity at the same venue become one event with a schedule.
 * - Mobile library stops are a library service, not events, and are left out.
 */

const FEED = "https://www.trumba.com/calendars/brisbane-city-council.json";
const TZ = "Australia/Brisbane";

export interface BneSession {
  eventID: string | number;
  title?: string;
  description?: string;
  location?: string;
  startDateTime?: string;
  endDateTime?: string;
  startTimeZoneOffset?: string;
  endTimeZoneOffset?: string;
  allDay?: string | boolean;
  canceled?: string | boolean;
  permaLinkUrl?: string;
  eventImage?: { url?: string } | null;
  categoryCalendar?: string;
  customFields?: { label: string; value: string }[] | null;
}

const MAP: [RegExp, string][] = [
  [/kids|children|toddler|baby|bubs|storytime|story time|rhyme|family|school holiday/, "family-shows"], [/market/, "street-festivals"],
  [/planetarium|astronom|science|stem\b/, "science-exhibitions"], [/walk|tour|bird|nature|bush/, "guided-tours"],
  [/exhibition|gallery|museum/, "art-exhibitions"], [/workshop|craft|art class|sewing|drawing|painting|creative/, "creative-workshops"],
  [/concert|music|choir|band/, "concerts"], [/film|movie|cinema/, "cinema"], [/talk|author|lecture|book club|history|seminar/, "public-lectures"],
  [/festival/, "festivals"], [/fitness|yoga|sport|active|swim|tennis|bootcamp|tai chi|pilates|dance|zumba|walk/, "sports"],
];

export function mapBneCategory(text: string): string {
  const t = text.toLowerCase();
  for (const [re, slug] of MAP) if (re.test(t)) return slug;
  return "culture";
}

const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
const truthy = (v: unknown) => v === true || v === "True" || v === "true";
const offsetOf = (o?: string) => (o && /^[+-]\d{4}$/.test(o) ? `${o.slice(0, 3)}:${o.slice(3)}` : "+10:00");

/** Pure mapping function — unit-tested in tests/brisbane.test.ts. */
export function normalizeBrisbane(rows: BneSession[], syncedAt: string, now = Date.now(), table: Record<string, { lat: number; lng: number } | null> = VENUES): ProviderBatch & { unplaced: number } {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];
  let unplaced = 0;
  type Group = { first: BneSession; cf: Record<string, string>; venue: string; address?: string; lat: number; lng: number; sessions: { start: number; end?: number; allDay: boolean; url?: string }[] };
  const groups = new Map<string, Group>();
  const seen = new Set<string>();
  for (const r of rows) {
    const title = plainText(r.title);
    if (!title || truthy(r.canceled) || seen.has(String(r.eventID))) continue;
    seen.add(String(r.eventID));
    if (/mobile library|pop.?up library/i.test(`${title} ${r.categoryCalendar ?? ""}`)) continue;
    const cf = Object.fromEntries((r.customFields ?? []).map((c) => [c.label, c.value]));
    const venue = decode((cf.Venue || r.location || "").replace(/<[^>]+>/g, "")).trim();
    if (!venue) continue;
    const link = cf["Venue address"] || (/<a /.test(cf.Venue ?? "") ? cf.Venue : "");
    const m = link.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    const geo = m ? { lat: Number(m[1]), lng: Number(m[2]) } : table[venue];
    if (!geo || geo.lat < -27.8 || geo.lat > -26.9 || geo.lng < 152.6 || geo.lng > 153.4) {
      unplaced++;
      continue;
    }
    const allDay = truthy(r.allDay);
    const start = Date.parse(`${r.startDateTime}${offsetOf(r.startTimeZoneOffset)}`);
    const endRaw = Date.parse(`${r.endDateTime}${offsetOf(r.endTimeZoneOffset)}`);
    if (!Number.isFinite(start)) continue;
    const end = Number.isFinite(endRaw) && endRaw > start ? endRaw : undefined;
    if ((end ?? start + (allDay ? 86400000 : 0)) < now) continue;
    const key = `${title.toLowerCase()}|${venue.toLowerCase()}`;
    const g = groups.get(key) ?? { first: r, cf, venue, address: decode(link.replace(/<[^>]+>/g, "")).trim() || undefined, lat: geo.lat, lng: geo.lng, sessions: [] };
    g.sessions.push({ start, end, allDay, url: r.permaLinkUrl });
    groups.set(key, g);
  }

  for (const [key, g] of groups) {
    g.sessions.sort((a, b) => a.start - b.start);
    const s0 = g.sessions[0];
    const r = g.first;
    const title = plainText(r.title)!;
    const venueId = `bne-v-${keyOf(g.venue)}-${slugify(g.venue).slice(0, 40)}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${g.venue}-brisbane-${keyOf(g.venue)}`),
        name: g.venue,
        address: g.address,
        city: "Brisbane",
        cityId: nearestCityId(g.lat, g.lng),
        country: "Australia",
        countryCode: "AU",
        lat: g.lat,
        lng: g.lng,
        timeZone: TZ,
        provenance: { provider: "brisbane", externalId: g.venue, lastSyncedAt: syncedAt, isDemo: false },
      });
    const kind = [g.cf["Event type"], g.cf["Primary event type"], g.cf["Activity type"], g.cf["Library event types"], r.categoryCalendar, title].filter(Boolean).join(" ");
    const cat = mapBneCategory(decode(kind));
    const cost = plainText(g.cf.Cost) ?? "";
    const isFree = /^free\b/i.test(cost) || (!cost && /\bfree\b/i.test(g.cf["Event type"] ?? ""));
    const price = isFree ? undefined : parseAmount(cost);
    const multi = s0.end !== undefined && s0.end - s0.start > 36 * 3600000;
    const id = `bne-e-${keyOf(key)}-${slugify(title).slice(0, 30)}`;
    const url = s0.url || "https://www.brisbane.qld.gov.au/whats-on";
    const bookings = plainText(g.cf.Bookings) ?? "";
    const registration = /book|regist/i.test(bookings) && !/no booking|not required/i.test(bookings);
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${title}-brisbane-${keyOf(key)}`),
      title,
      description: [plainText(r.description), bookings].filter(Boolean).join(" ").slice(0, 1500) || undefined,
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: multi ? "multi_day" : g.sessions.length > 1 ? "recurring" : "single",
      venueId,
      start: new Date(s0.start).toISOString(),
      end: s0.end !== undefined && (multi || g.sessions.length === 1) ? new Date(s0.end).toISOString() : undefined,
      schedule: !multi && g.sessions.length > 1 ? g.sessions.slice(1, 200).map((x) => new Date(x.start).toISOString()) : undefined,
      hoursUnknown: s0.allDay || undefined,
      timeZone: TZ,
      status: isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? (registration ? "registration" : "free") : price !== undefined ? "ticketed" : "unknown",
      isFree,
      registrationRequired: registration,
      online: false,
      familyFriendly: cat === "family-shows" || /kids|famil|all ages/i.test(`${g.cf.Age ?? ""} ${g.cf["Age range"] ?? ""}`),
      officialUrl: url,
      imageUrl: r.eventImage?.url || undefined,
      posterHue: hueOf(key),
      participants: [],
      provenance: { provider: "brisbane", externalId: String(r.eventID), sourceUrl: url, lastSyncedAt: syncedAt, isDemo: false },
    });
    if (price !== undefined)
      offers.push({
        id: `${id}-tickets`,
        eventId: id,
        provider: "Brisbane City Council",
        providerType: "primary",
        ticketCategory: "standard",
        label: `Advertised: ${cost.slice(0, 80)}`,
        basePrice: price,
        currency: "AUD",
        availability: "unknown",
        purchaseUrl: url,
        priceObservedAt: syncedAt,
        isDemo: false,
      });
  }
  return { events, venues: [...venues.values()], participants: [], offers, unplaced };
}

export const brisbaneProvider: ProviderAdapter = {
  id: "brisbane",
  name: "Brisbane City Council events",
  isDemo: false,
  coverage: "Brisbane City Council's events: libraries, parks, markets, Botanic Gardens, Planetarium, Museum of Brisbane, seniors and kids programmes.",
  attribution: "Data: Brisbane City Council events calendar.",
  isConfigured: () => true,
  refreshIntervalMs: 12 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const now = new Date();
    const months = Array.from({ length: 13 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)).toISOString().slice(0, 10).replace(/-/g, ""));
    const rows: BneSession[] = [];
    let failures = 0;
    const queue = [...months];
    const worker = async () => {
      while (queue.length) {
        const ymd = queue.shift()!;
        try {
          rows.push(...((await fetchJson("brisbane", `${FEED}?startdate=${ymd}&months=1`, ctx, { revalidate: 0, timeoutMs: 60000 })) as BneSession[]));
        } catch (err) {
          failures++;
          ctx.log("brisbane month failed", { ymd, err: String(err).slice(0, 160) });
        }
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));
    const { unplaced, ...batch } = normalizeBrisbane(rows, syncedAt);
    if (unplaced) ctx.log("brisbane sessions at venues not located", { unplaced });
    return { batch, run: { imported: batch.events.length, updated: 0, failures, rateLimited: false, ok: batch.events.length > 0, finishedAt: new Date().toISOString(), error: failures ? `${failures} of ${months.length} months failed` : undefined } };
  },
};
