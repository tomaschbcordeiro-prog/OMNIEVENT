import tzlookup from "@photostructure/tz-lookup";
import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { hueOf, nearestCityId, parseLocal, sleep } from "./common";
import SNAPSHOT from "./data/bol-events.json";
import GEOCODED from "./data/bol-venues.json";

/**
 * BOL (bol.pt), a Portuguese ticket seller covering theatres, concert halls, museums and
 * festivals across the country, from big cities to small municipal auditoriums.
 *
 * - Each category listing publishes every show as schema.org Event data (JSON-LD), with the
 *   venue's coordinates, address, price and availability. Five listings cover the catalogue.
 * - Venues the listing gives no coordinates for were located once from their street address
 *   and postcode (data/bol-venues.json, made by scripts/fetch-bol.mjs). Shows at venues we
 *   couldn't place are skipped rather than guessed.
 * - If the live site can't be reached, the snapshot saved by the same script is used.
 */

const BASE = "https://www.bol.pt";
const UA = "OMNIEVENT/1.0 (+https://omnievent.vercel.app)";

/** BOL's top-level categories and where they sit in ours. */
export const BOL_CATEGORIES: Record<number, string> = { 1: "theatre", 2: "music", 3: "family", 4: "sports", 5: "other" };

export interface BolEvent {
  productID: string;
  name: string;
  url: string;
  image?: string;
  startDate?: string;
  endDate?: string;
  duration?: string;
  location?: {
    name?: string;
    url?: string;
    geo?: { latitude?: string | number; longitude?: string | number };
    address?: { streetAddress?: string; postalCode?: string; addressLocality?: string; addressCountry?: string };
  };
  offers?: { availability?: string; url?: string; price?: string | number; priceCurrency?: string };
  /** Added by us: which BOL category listing it came from. */
  bolCategory?: number;
}

/** Reads the JSON-LD Event blocks of a BOL listing page. */
export function parseBolListing(html: string, bolCategory?: number): BolEvent[] {
  const out: BolEvent[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]) as BolEvent & { "@type"?: string };
      if (d["@type"] === "Event" && d.productID && d.name && d.url) out.push({ ...d, bolCategory });
    } catch {
      // a broken block doesn't stop the rest
    }
  }
  return out;
}

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Checked in order; the first match decides.
const KEYWORDS: [RegExp, string][] = [
  [/stand.?up|comedia|humor|humorista/, "stand-up"],
  [/fado/, "traditional"],
  [/jazz|blues/, "jazz"],
  [/opera\b/, "opera"],
  [/orquestra|sinfonic|filarmonic|classic|piano|recital|quarteto|camerata|coro\b|choir/, "classical"],
  [/festival/, "music-festivals"],
  [/musical\b/, "musicals"],
  [/bailado|ballet/, "ballet"],
  [/danca|dance/, "dance"],
  [/circo|circus/, "circus"],
  [/magia|magic|ilusionis/, "magic"],
  [/museu|museum|exposic|galeria|monumento|palacio|castelo|mosteiro/, "art-exhibitions"],
  [/workshop|oficina|atelier|curso|aula|masterclass/, "creative-workshops"],
  [/conferencia|palestra|debate|tertulia/, "public-lectures"],
  [/visita guiada|percurso|roteiro|walking tour/, "guided-tours"],
  [/trail|caminhada|corrida|maratona|run\b|sao silvestre/, "marathon"],
  [/futebol|futsal|\bx\b|\bvs\.?\b/, "football"],
  [/planetario/, "planetariums"],
  [/\bcinema\b|\bfilme\b|\bfilm\b|sessao de cinema/, "cinema"],
];

const BY_GROUP: Record<string, string> = { theatre: "plays", music: "concerts", family: "family-shows", sports: "sports", other: "culture" };

export function mapBolCategory(e: Pick<BolEvent, "name" | "bolCategory" | "location">): string {
  const group = BOL_CATEGORIES[e.bolCategory ?? 0] ?? "other";
  const title = norm(e.name);
  const venue = norm(e.location?.name ?? "");
  for (const [re, slug] of KEYWORDS) {
    // The venue's name only tells us about museums ("Cine-Teatro" hosts plays, not films).
    if (!re.test(title) && !(slug === "art-exhibitions" && (group === "theatre" || group === "other") && re.test(venue))) continue;
    // Keep the listing's own group when the keyword would move a show somewhere odd.
    if (group === "family" && !["circus", "magic", "art-exhibitions", "creative-workshops"].includes(slug)) return "family-shows";
    if (group === "sports" && !["marathon", "football", "guided-tours"].includes(slug)) continue;
    return slug;
  }
  if (group === "family") return "family-shows";
  if (group === "music" && /\bdj\b/.test(title)) return "dj-sets";
  return BY_GROUP[group];
}

// Admin items sold through BOL that aren't events (memberships, vouchers, applications…).
const NOT_EVENTS = /atendimento|candidatura|voucher|vale ?oferta|cart[aã]o|quota|socio|donativo|doa[cç][aã]o|inscri[cç][aã]o anual|^\s*(janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b[\s/]/i;

type Geo = { lat: number; lng: number };

/** Coordinates for a BOL venue: its own, corrected for a missing minus sign, or our lookup. */
export function venueGeo(loc: BolEvent["location"], table: Record<string, Geo> = GEOCODED as Record<string, Geo>): Geo | undefined {
  const lat = Number(loc?.geo?.latitude);
  let lng = Number(loc?.geo?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0) {
    // Portugal is entirely west of Greenwich; a few listings drop the sign.
    if (lng > 0 && lng < 32) lng = -lng;
    if (lat > 30 && lat < 42.3 && lng > -31.5 && lng < -6) return { lat, lng };
  }
  return loc?.url ? table[loc.url] : undefined;
}

/** "PT1H46M" → 106 minutes. */
function minutes(d?: string): number | undefined {
  const m = d?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!m) return undefined;
  const n = Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
  return n > 0 ? n : undefined;
}

/** Pure mapping function — unit-tested in tests/bol.test.ts. */
export function normalizeBol(raw: BolEvent[], syncedAt: string, now = Date.now(), table?: Record<string, Geo>): ProviderBatch & { skipped: number } {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const e of raw) {
    if (seen.has(e.productID)) continue;
    seen.add(e.productID);
    if (NOT_EVENTS.test(e.name)) continue;
    const geo = venueGeo(e.location, table);
    if (!geo) {
      skipped++;
      continue;
    }
    let tz = "Europe/Lisbon";
    try {
      tz = tzlookup(geo.lat, geo.lng);
    } catch {
      // keep Lisbon time
    }
    const start = parseLocal(e.startDate, tz);
    if (start === undefined) continue;
    let end = parseLocal(e.endDate, tz);
    if (end !== undefined && end <= start) end = undefined;
    if ((end ?? start) < now - 3 * 3600000) continue;

    const loc = e.location ?? {};
    const venueKey = loc.url ?? `${loc.name}-${geo.lat.toFixed(4)}`;
    const venueId = `bol-v-${slugify(venueKey.replace(/^https?:\/\/[^/]+/, "")).slice(0, 80)}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${loc.name ?? "local"}-${loc.address?.addressLocality ?? ""}-${hueOf(venueKey)}`),
        name: loc.name ?? "Venue",
        address: [loc.address?.streetAddress, loc.address?.postalCode].filter((x) => x && x !== "-").join(", ") || undefined,
        city: loc.address?.addressLocality ?? "",
        cityId: nearestCityId(geo.lat, geo.lng),
        country: "Portugal",
        countryCode: "PT",
        lat: geo.lat,
        lng: geo.lng,
        timeZone: tz,
        provenance: { provider: "bol", externalId: venueKey, sourceUrl: loc.url, lastSyncedAt: syncedAt, isDemo: false },
      });

    const id = `bol-e-${e.productID.replace(/[^0-9a-z_]/gi, "")}`;
    const cat = mapBolCategory(e);
    // Daily dates usually mean a museum or exhibition open over a period, not one session.
    const longRun = end !== undefined && end - start > 36 * 3600000;
    const dateOnly = /T00:00:00/.test(e.startDate ?? "");
    const price = Number(e.offers?.price);
    const isFree = Number.isFinite(price) && price === 0;
    const soldOut = /SoldOut/i.test(e.offers?.availability ?? "");
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${e.name}-${loc.address?.addressLocality ?? ""}-${e.productID.replace(/\D/g, "")}`),
      title: e.name.trim(),
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: longRun ? "multi_day" : "single",
      venueId,
      start: new Date(start).toISOString(),
      end: end !== undefined ? new Date(end).toISOString() : undefined,
      durationMinutes: longRun ? undefined : minutes(e.duration),
      hoursUnknown: dateOnly || undefined,
      timeZone: tz,
      status: soldOut ? "sold_out" : isFree ? "free_entry" : "on_sale",
      ticketAccess: isFree ? "free" : "ticketed",
      isFree,
      registrationRequired: isFree,
      online: false,
      familyFriendly: BOL_CATEGORIES[e.bolCategory ?? 0] === "family",
      officialUrl: e.url,
      imageUrl: e.image,
      posterHue: hueOf(e.productID),
      participants: [],
      provenance: { provider: "bol", externalId: e.productID, sourceUrl: e.url, lastSyncedAt: syncedAt, isDemo: false },
    });
    offers.push({
      id: `${id}-bol`,
      eventId: id,
      provider: "BOL",
      providerType: "primary",
      ticketCategory: "standard",
      label: isFree ? "Free, booking through BOL" : "Tickets on BOL (lowest listed price)",
      basePrice: Number.isFinite(price) && price > 0 ? price : undefined,
      currency: Number.isFinite(price) && price > 0 ? (e.offers?.priceCurrency ?? "EUR") : "",
      availability: soldOut ? "sold_out" : /InStock|LimitedAvailability/i.test(e.offers?.availability ?? "") ? "available" : "unknown",
      purchaseUrl: e.offers?.url ?? e.url,
      priceObservedAt: Number.isFinite(price) ? syncedAt : undefined,
      isDemo: false,
    });
  }
  return { events, venues: [...venues.values()], participants: [], offers, skipped };
}

async function fetchListing(cat: number, signal?: AbortSignal): Promise<BolEvent[]> {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BASE}/Comprar/pesquisa/${cat}-0-0-0-0-0/bilhetes`, {
        headers: { "User-Agent": UA, "Accept-Language": "pt-PT,pt;q=0.9" },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const list = parseBolListing(html, cat);
      // A page without any show is a block or challenge page, not an empty catalogue.
      if (!list.length) throw new Error(`no shows on the page (${html.length} bytes${/captcha|challenge|cloudflare|access denied/i.test(html) ? ", looks like a bot check" : ""})`);
      return list;
    } catch (err) {
      last = String(err);
      await sleep(2000);
    }
  }
  throw new Error(`category ${cat}: ${last}`);
}

export const bolProvider: ProviderAdapter = {
  id: "bol",
  name: "BOL (Portugal)",
  isDemo: false,
  coverage: "Shows, concerts, museums, festivals and family activities sold through BOL, all over Portugal including the islands.",
  attribution: "Event data and ticket links from BOL (bol.pt).",
  isConfigured: () => true,
  refreshIntervalMs: 3 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const snap = SNAPSHOT as unknown as { fetchedAt: string; events: BolEvent[] };
    const raw: BolEvent[] = [];
    const failed: number[] = [];
    // Show the snapshot at once; the live listings replace it when they arrive.
    const { skipped: _s, ...first } = normalizeBol(snap.events, syncedAt);
    void _s;
    ctx.onProgress?.(first);
    for (const cat of Object.keys(BOL_CATEGORIES).map(Number)) {
      try {
        raw.push(...(await fetchListing(cat, ctx.signal)));
      } catch (err) {
        failed.push(cat);
        ctx.log("bol listing failed", { cat, err: String(err) });
        raw.push(...snap.events.filter((e) => e.bolCategory === cat));
      }
      await sleep(800);
    }
    const { skipped, ...batch } = normalizeBol(raw, syncedAt);
    if (skipped) ctx.log("bol shows at venues without coordinates", { skipped });
    return {
      batch,
      run: {
        imported: batch.events.length,
        updated: 0,
        failures: failed.length,
        rateLimited: false,
        ok: batch.events.length > 0,
        finishedAt: new Date().toISOString(),
        error: failed.length ? `live listing unavailable for ${failed.length} categor${failed.length === 1 ? "y" : "ies"}; showing the snapshot from ${snap.fetchedAt.slice(0, 16).replace("T", " ")} UTC` : undefined,
      },
    };
  },
};
