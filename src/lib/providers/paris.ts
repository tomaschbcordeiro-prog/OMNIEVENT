import { groupOf } from "../categories";
import { slugify } from "../destinations";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, nearestCityId, parseLocal, plainText, sleep } from "./common";

/**
 * "Que faire à Paris ?" — the City of Paris event listings (opendata.paris.fr, no key).
 *
 * - Licence: ODbL. Attribution: "Ville de Paris".
 * - `occurrences` lists each session as "start_end;start_end" with UTC offsets. Records
 *   without sessions only have a date range, which we list as a multi-day run.
 * - The records API serves at most 100 rows per request, so we page through.
 */

const BASE = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/que-faire-a-paris-/records";
const TZ = "Europe/Paris";
const FIELDS = "id,url,title,lead_text,date_start,date_end,occurrences,cover_url,address_name,address_street,address_zipcode,address_city,lat_lon,price_type,price_detail,access_type,access_link,qfap_tags,audience,pmr";

export interface ParisRecord {
  id?: string | number;
  url?: string;
  title?: string;
  lead_text?: string;
  date_start?: string;
  date_end?: string;
  occurrences?: string | null;
  cover_url?: string;
  address_name?: string;
  address_street?: string;
  address_zipcode?: string;
  address_city?: string;
  lat_lon?: { lat?: number; lon?: number } | null;
  price_type?: string;
  price_detail?: string;
  access_type?: string;
  access_link?: string;
  qfap_tags?: string | null;
  audience?: string;
  pmr?: number | string | null;
}

// First matching tag wins, so the more specific tags come first.
const TAG_MAP: [string, string][] = [
  ["opéra", "opera"], ["musique classique", "classical"], ["jazz", "jazz"], ["electro", "electronic"],
  ["hip-hop", "hip-hop"], ["rock", "rock-metal"], ["pop", "pop"], ["clubbing", "club-nights"],
  ["spectacle musical", "musicals"], ["concert", "concerts"], ["musique", "concerts"],
  ["humour", "stand-up"], ["théâtre", "plays"], ["danse", "dance"], ["cirque", "circus"], ["magie", "magic"],
  ["street-art", "art-exhibitions"], ["art contemporain", "art-exhibitions"], ["photo", "photography"],
  ["peinture", "art-exhibitions"], ["sciences", "science-exhibitions"], ["histoire", "history-exhibitions"],
  ["expo", "art-exhibitions"], ["cinéma", "cinema"], ["conférence", "public-lectures"], ["lecture", "spoken-word"],
  ["littérature", "spoken-word"], ["salon", "trade-fairs"], ["gourmand", "food-drink"], ["festival", "festivals"],
  ["balade urbaine", "guided-tours"], ["nature", "outdoor"], ["sport", "sports"], ["atelier", "creative-workshops"],
  ["enfants", "family"], ["brocante", "street-festivals"], ["loisirs", "culture"],
];

export function mapParisTags(tags?: string | null): string {
  const list = (tags ?? "").toLowerCase().split(";").map((t) => t.trim());
  for (const [tag, slug] of TAG_MAP) if (list.includes(tag)) return slug;
  return "culture";
}

/** Parse "start_end;start_end" sessions into [start, end] instants. */
export function parseOccurrences(s?: string | null): [number, number][] {
  if (!s) return [];
  const out: [number, number][] = [];
  for (const part of s.split(";")) {
    const [a, b] = part.split("_");
    const st = Date.parse(a);
    const en = Date.parse(b ?? "");
    if (Number.isFinite(st)) out.push([st, Number.isFinite(en) && en > st ? en : st + 2 * 3600000]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

const localDay = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: TZ });

/** Pure mapping function — unit-tested with fixtures in tests/sources.test.ts. */
export function normalizeParis(raw: ParisRecord[], syncedAt: string, now = Date.now()): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];
  const cutoff = now - 3600000;

  for (const r of raw) {
    const lat = Number(r.lat_lon?.lat);
    const lng = Number(r.lat_lon?.lon);
    const extId = r.id != null ? String(r.id) : "";
    if (!extId || !r.title || !r.lat_lon || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    let start: number;
    let end: number | undefined;
    let schedule: string[] | undefined;
    let durationMinutes: number | undefined;
    let eventType: OmniEvent["eventType"] = "single";
    let statusNote: string | undefined;
    let hoursUnknown: true | undefined;
    const sessions = parseOccurrences(r.occurrences).filter(([, e]) => e > cutoff);
    if (sessions.length) {
      [start, end] = sessions[0];
      durationMinutes = Math.round((end - start) / 60000);
      // A session "starting" at local midnight is the listing's placeholder for "no time given".
      if (new Date(start).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) === "00:00") {
        hoursUnknown = true;
        durationMinutes = undefined;
      }
      if (sessions.length > 1) {
        eventType = "recurring";
        schedule = sessions.slice(1, 120).map(([s]) => new Date(s).toISOString());
        end = undefined;
      }
    } else if (r.occurrences) {
      continue; // every session is over
    } else {
      // Only a date range. The dataset stores local dates with a "+00:00" suffix.
      const first = parseLocal(r.date_start?.slice(0, 10), TZ);
      const last = parseLocal(r.date_end ? `${r.date_end.slice(0, 10)} 23:59` : undefined, TZ);
      if (first === undefined || last === undefined || last < now) continue;
      const today = parseLocal(localDay(now), TZ)!;
      start = Math.max(first, today);
      end = last;
      eventType = localDay(first) === localDay(last) ? "single" : "multi_day";
      hoursUnknown = true;
      if (first < today) statusNote = `Running since ${r.date_start!.slice(0, 10)}.`;
    }

    const venueName = r.address_name?.trim() || "Paris";
    const city = r.address_city?.replace(/\s*France$/i, "").trim() || "Paris";
    const venueKey = `${slugify(venueName)}-${lat.toFixed(4)}-${lng.toFixed(4)}`;
    const venueId = `par-v-${venueKey}`;
    if (!venues.has(venueId)) {
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${venueName}-${city}-${lat.toFixed(3)}-${lng.toFixed(3)}`),
        name: venueName,
        address: [r.address_street, r.address_zipcode].filter(Boolean).join(", ") || undefined,
        city,
        cityId: nearestCityId(lat, lng),
        country: "France",
        countryCode: "FR",
        lat,
        lng,
        timeZone: TZ,
        accessibility: Number(r.pmr) === 1 ? ["Wheelchair accessible (per the City of Paris listing)."] : undefined,
        provenance: { provider: "paris", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });
    }

    const cat = mapParisTags(r.qfap_tags);
    const group = groupOf(cat);
    const price = (r.price_type ?? "").toLowerCase();
    const isFree = price === "gratuit";
    const registration = (r.access_type ?? "").toLowerCase() === "obligatoire";
    const id = `par-e-${extId}`;
    const priceText = plainText(r.price_detail);
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${r.title}-${extId}`),
      title: r.title.trim(),
      description: [plainText(r.lead_text), priceText && `Prices: ${priceText}`].filter(Boolean).join("\n\n") || undefined,
      categorySlug: cat,
      groupSlug: group,
      eventType,
      venueId,
      hoursUnknown,
      start: new Date(start).toISOString(),
      end: end !== undefined ? new Date(end).toISOString() : undefined,
      durationMinutes,
      schedule,
      timeZone: TZ,
      status: isFree ? "free_entry" : registration ? "registration_required" : "scheduled",
      statusNote,
      ticketAccess: isFree ? (registration ? "registration" : "free") : price.startsWith("gratuit") ? "free" : price === "payant" ? "ticketed" : "unknown",
      isFree: price.startsWith("gratuit"),
      registrationRequired: registration,
      online: false,
      familyFriendly: group === "family" || /enfant|famil/i.test(`${r.qfap_tags ?? ""} ${r.audience ?? ""}`),
      officialUrl: r.url,
      imageUrl: r.cover_url || undefined,
      posterHue: hueOf(extId),
      participants: [],
      provenance: { provider: "paris", externalId: extId, sourceUrl: r.url, lastSyncedAt: syncedAt, isDemo: false },
    });
    const link = r.access_link || r.url;
    if (link) {
      offers.push({
        id: `${id}-info`,
        eventId: id,
        provider: r.access_link ? "Official booking" : "Ville de Paris",
        providerType: "organizer",
        ticketCategory: "standard",
        label: isFree ? (registration ? "Free, booking required" : "Free entry") : registration ? "Booking required, prices on the official page" : "Prices on the official page",
        currency: "",
        availability: "unknown",
        purchaseUrl: link,
        isDemo: false,
      });
    }
  }
  return { events, venues: [...venues.values()], participants: [], offers };
}

export const parisProvider: ProviderAdapter = {
  id: "paris",
  name: "Que faire à Paris (City of Paris open data)",
  isDemo: false,
  coverage: "Events, exhibitions, workshops and activities listed by the City of Paris.",
  attribution: "Source: Ville de Paris, opendata.paris.fr (ODbL).",
  isConfigured: () => true,
  refreshIntervalMs: 6 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const raw: ParisRecord[] = [];
    let failures = 0;
    let lastError = "";
    // Hour-rounded so repeat requests hit the data cache.
    const since = new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString().slice(0, 19);
    for (let offset = 0; offset < Math.min(ctx.maxEvents, 9900); offset += 100) {
      const url = new URL(BASE);
      url.searchParams.set("limit", "100");
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("select", FIELDS);
      url.searchParams.set("where", `date_end >= "${since}"`);
      url.searchParams.set("order_by", "id");
      try {
        const json = (await fetchJson("paris", url, ctx, { timeoutMs: 20000 })) as { total_count?: number; results?: ParisRecord[] };
        const list = json.results ?? [];
        raw.push(...list);
        if (list.length < 100 || offset + 100 >= (json.total_count ?? 0)) break;
      } catch (err) {
        failures++;
            lastError = String(err).slice(0, 160);
        ctx.log("paris page failed", { offset, err: String(err) });
        if (failures >= 3) break;
        await sleep(1500);
        offset -= 100; // retry the same page
      }
    }
    const batch = normalizeParis(raw, syncedAt);
    return {
      batch,
      run: { imported: batch.events.length, updated: 0, failures, rateLimited: false, ok: batch.events.length > 0 || failures === 0, finishedAt: new Date().toISOString(), error: failures ? `${failures} page request(s) failed (last: ${lastError})` : undefined },
    };
  },
};
