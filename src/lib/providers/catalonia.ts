import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, nearestCityId, parseAmount, plainText, zonedDay } from "./common";

/**
 * Agenda Cultural de Catalunya: the Generalitat's open data feed of cultural activities
 * across all of Catalonia (theatre, concerts, exhibitions, festivals, family activities),
 * published on the Socrata portal analisi.transparenciacatalunya.cat. No key needed.
 */

const URL_ = "https://analisi.transparenciacatalunya.cat/resource/rhpv-yr4f.json";
const TZ = "Europe/Madrid";
const IMG = "https://agenda.cultura.gencat.cat";

export interface CatRow {
  codi: string;
  denominaci?: string;
  subt_tol?: string;
  descripcio?: string;
  descripcio_html?: string;
  data_inici?: string;
  data_fi?: string;
  horari?: string;
  gratuita?: string;
  entrades?: string;
  linkbotoentrades?: string;
  imatges?: string;
  adre_a?: string;
  espai?: string;
  latitud?: string;
  longitud?: string;
  municipi?: string;
  modalitat?: string;
  tags_categor_es?: string;
}

// First match wins, so specific tags come before general ones.
const CATEGORY: [string, string][] = [
  ["opera", "opera"], ["circ", "circus"], ["magia", "magic"], ["dansa", "dance"], ["sardanes", "traditional"],
  ["infantil", "family-shows"], ["concerts", "concerts"], ["teatre", "plays"], ["exposicions", "art-exhibitions"],
  ["cultura-digital", "digital-art"], ["rutes-i-visites", "guided-tours"], ["conferencies", "public-lectures"],
  ["cursos", "creative-workshops"], ["nadal", "seasonal-festivals"], ["festes", "street-festivals"],
  ["fires-i-mercats", "street-festivals"], ["festivals-i-mostres", "festivals"], ["commemoracions", "heritage"],
  ["any-gaudi", "heritage"],
];

export function mapCatCategory(tags?: string): string {
  const list = (tags ?? "").split(",").map((t) => t.trim().replace(/^agenda:categories\//, ""));
  for (const [tag, slug] of CATEGORY) if (list.includes(tag)) return slug;
  return "culture";
}

/** "18 h", "17.30 h", "A les 19 h" → "18:00"; opening hours and blanks → undefined. */
export function catStartTime(horari?: string): string | undefined {
  const m = (horari ?? "").trim().match(/^(?:a les\s+)?(\d{1,2})(?:[.:](\d{2}))?\s*h\b/i);
  if (!m || Number(m[1]) > 23) return undefined;
  return `${m[1].padStart(2, "0")}:${m[2] ?? "00"}`;
}

const town = (path?: string) =>
  (path ?? "").split("/").pop()?.replace(/-/g, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase()).replace(/\b(De|Del|La|El|Les|Els|I)\b/g, (w) => w.toLowerCase()) ?? "";

/** Pure mapping function — unit-tested in tests/catalonia.test.ts. */
export function normalizeCatalonia(rows: CatRow[], syncedAt: string, now = Date.now()): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];
  for (const r of rows) {
    const lat = Number(r.latitud);
    const lng = Number(r.longitud);
    if (!r.codi || !r.denominaci || !Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || r.modalitat === "Virtual") continue;
    // Catalonia lies roughly within these bounds; anything else is a typo in the feed.
    if (lat < 40.4 || lat > 42.95 || lng < 0.1 || lng > 3.4) continue;
    const day0 = r.data_inici?.slice(0, 10);
    const day1 = r.data_fi?.slice(0, 10) ?? day0;
    if (!day0) continue;
    const time = catStartTime(r.horari);
    const start = zonedDay(day0, TZ, time);
    const endDay = zonedDay(day1!, TZ, "23:59");
    if (start === undefined || endDay === undefined || endDay < now) continue;
    const multi = day1 !== day0;

    const city = town(r.municipi);
    const venueName = r.espai?.trim() || r.adre_a?.trim() || city;
    const venueKey = `${venueName}|${lat.toFixed(4)},${lng.toFixed(4)}`;
    const venueId = `cat-v-${hueOf(venueKey)}-${slugify(venueName).slice(0, 40)}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${venueName}-${city}-${hueOf(venueKey)}`),
        name: venueName,
        address: r.adre_a?.trim() || undefined,
        city,
        cityId: nearestCityId(lat, lng),
        country: "Spain",
        countryCode: "ES",
        lat,
        lng,
        timeZone: TZ,
        provenance: { provider: "catalonia", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });

    const cat = mapCatCategory(r.tags_categor_es);
    const id = `cat-e-${r.codi}`;
    const isFree = /^s[ií]/i.test(r.gratuita ?? "");
    const price = isFree ? undefined : parseAmount(r.entrades);
    const link = r.descripcio_html?.match(/href="(https?:\/\/[^"]+)"/)?.[1];
    const image = r.imatges?.split(",")[0]?.trim();
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${r.denominaci}-${city}-${r.codi.slice(-6)}`),
      title: plainText(r.denominaci) ?? r.denominaci,
      description: [r.subt_tol, plainText(r.descripcio)].filter(Boolean).join(". ").slice(0, 1500) || undefined,
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: multi ? "multi_day" : "single",
      venueId,
      start: new Date(start).toISOString(),
      end: multi ? new Date(endDay).toISOString() : undefined,
      hoursUnknown: !time || undefined,
      timeZone: TZ,
      status: isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? "free" : r.linkbotoentrades || r.entrades ? "ticketed" : "unknown",
      isFree,
      registrationRequired: false,
      online: false,
      familyFriendly: cat === "family-shows" || /infantil/.test(r.tags_categor_es ?? ""),
      officialUrl: link,
      imageUrl: image ? (image.startsWith("http") ? image : `${IMG}${image}`) : undefined,
      posterHue: hueOf(r.codi),
      participants: [],
      provenance: { provider: "catalonia", externalId: r.codi, sourceUrl: link, lastSyncedAt: syncedAt, isDemo: false },
    });
    if (r.linkbotoentrades || price !== undefined)
      offers.push({
        id: `${id}-tickets`,
        eventId: id,
        provider: r.linkbotoentrades ? new URL(r.linkbotoentrades).hostname.replace(/^www\./, "") : venueName,
        providerType: "primary",
        ticketCategory: "standard",
        label: price !== undefined ? "Advertised price (see the seller for all prices)" : "Tickets",
        basePrice: price,
        currency: price !== undefined ? "EUR" : "",
        availability: "unknown",
        purchaseUrl: r.linkbotoentrades || link || IMG,
        priceObservedAt: price !== undefined ? syncedAt : undefined,
        isDemo: false,
      });
  }
  return { events, venues: [...venues.values()], participants: [], offers };
}

export const cataloniaProvider: ProviderAdapter = {
  id: "catalonia",
  name: "Agenda Cultural de Catalunya",
  isDemo: false,
  coverage: "Cultural activities across all of Catalonia: theatre, concerts, exhibitions, festivals and family activities, in towns large and small.",
  attribution: "Data: Generalitat de Catalunya, Agenda Cultural (open data, CC BY).",
  isConfigured: () => true,
  refreshIntervalMs: 3 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const url = new URL(URL_);
    url.searchParams.set("$limit", "20000");
    url.searchParams.set("$where", `data_fi >= '${new Date().toISOString().slice(0, 10)}'`);
    const rows = (await fetchJson("catalonia", url, ctx, { revalidate: 0, timeoutMs: 60000 })) as CatRow[];
    const batch = normalizeCatalonia(rows, syncedAt);
    return { batch, run: { imported: batch.events.length, updated: 0, failures: 0, rateLimited: false, ok: true, finishedAt: new Date().toISOString() } };
  },
};
