import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, nearestCityId, plainText, sleep, zonedDay } from "./common";

/**
 * Zaragoza City Council's open events API: the city's cultural and leisure agenda (museums,
 * theatres, civic centres, libraries, festivals), with coordinates, times and prices.
 */

const API = "https://www.zaragoza.es/sede/servicio/cultura/evento/list.json";
const TZ = "Europe/Madrid";

export interface ZgzEvent {
  id: string | number;
  title?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  image?: string;
  type?: string;
  category?: { title?: string }[];
  geometry?: { coordinates?: [number, number] };
  location?: string;
  price?: { hasCurrencyValue?: number; hasCurrency?: string; fareGroup?: string }[];
  priceComment?: string;
  subEvent?: { startDate?: string; endDate?: string; openingHours?: { startTime?: string }[]; location?: { title?: string; streetAddress?: string; geometry?: { coordinates?: [number, number] } } }[];
}

const MAP: [RegExp, string][] = [
  [/infantil|niñ|famil/, "family-shows"], [/teatro/, "plays"], [/danza/, "dance"], [/concierto|música|musica/, "concerts"],
  [/cine/, "cinema"], [/exposici/, "art-exhibitions"], [/visita/, "guided-tours"], [/conferencia|charla|presentaci/, "public-lectures"],
  [/taller|curso/, "creative-workshops"], [/festival|fiesta/, "festivals"], [/deport/, "sports"],
];

export function mapZgzCategory(e: Pick<ZgzEvent, "type" | "category" | "title">): string {
  const t = `${e.type ?? ""} ${(e.category ?? []).map((c) => c.title).join(" ")}`.toLowerCase();
  for (const [re, slug] of MAP) if (re.test(t)) return slug;
  return "culture";
}

/** Pure mapping function — unit-tested in tests/zaragoza.test.ts. */
export function normalizeZaragoza(rows: ZgzEvent[], syncedAt: string, now = Date.now()): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];
  for (const e of rows) {
    const sub = e.subEvent?.[0];
    const [lng, lat] = e.geometry?.coordinates ?? sub?.location?.geometry?.coordinates ?? [NaN, NaN];
    if (!e.id || !e.title || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < 41.4 || lat > 41.9 || lng < -1.3 || lng > -0.6) continue;
    const day0 = e.startDate?.slice(0, 10);
    const day1 = e.endDate?.slice(0, 10) ?? day0;
    if (!day0) continue;
    const time = sub?.openingHours?.[0]?.startTime?.match(/^\d{1,2}:\d{2}/)?.[0];
    const multi = day1 !== day0;
    const start = zonedDay(day0, TZ, multi ? undefined : time);
    const endDay = zonedDay(day1!, TZ, "23:59");
    if (start === undefined || endDay === undefined || endDay < now) continue;

    const name = e.location?.trim() || sub?.location?.title?.trim() || "Zaragoza";
    const venueKey = `${name}|${lat.toFixed(4)},${lng.toFixed(4)}`;
    const venueId = `zgz-v-${hueOf(venueKey)}-${slugify(name).slice(0, 40)}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${name}-zaragoza-${hueOf(venueKey)}`),
        name,
        address: sub?.location?.streetAddress?.trim() || undefined,
        city: "Zaragoza",
        cityId: nearestCityId(lat, lng),
        country: "Spain",
        countryCode: "ES",
        lat,
        lng,
        timeZone: TZ,
        provenance: { provider: "zaragoza", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });

    const cat = mapZgzCategory(e);
    const prices = (e.price ?? []).map((p) => Number(p.hasCurrencyValue)).filter((n) => Number.isFinite(n));
    const isFree = prices.length > 0 && Math.max(...prices) === 0 || /gratuit|entrada libre/i.test(plainText(e.priceComment) ?? "");
    const min = prices.filter((n) => n > 0).sort((a, b) => a - b)[0];
    const id = `zgz-e-${e.id}`;
    const page = `https://www.zaragoza.es/sede/servicio/cultura/evento/${e.id}`;
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${e.title}-zaragoza-${e.id}`),
      title: plainText(e.title) ?? e.title,
      description: plainText(e.description)?.slice(0, 1500),
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: multi ? "multi_day" : "single",
      venueId,
      start: new Date(start).toISOString(),
      end: multi ? new Date(endDay).toISOString() : undefined,
      hoursUnknown: multi || !time || undefined,
      timeZone: TZ,
      status: isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? "free" : min !== undefined ? "ticketed" : "unknown",
      isFree,
      registrationRequired: false,
      online: false,
      familyFriendly: cat === "family-shows",
      officialUrl: page,
      imageUrl: e.image ? (e.image.startsWith("//") ? `https:${e.image}` : e.image) : undefined,
      posterHue: hueOf(String(e.id)),
      participants: [],
      provenance: { provider: "zaragoza", externalId: String(e.id), sourceUrl: page, lastSyncedAt: syncedAt, isDemo: false },
    });
    if (min !== undefined)
      offers.push({
        id: `${id}-price`,
        eventId: id,
        provider: name,
        providerType: "box_office",
        ticketCategory: "standard",
        label: "Advertised price",
        basePrice: min,
        currency: "EUR",
        availability: "unknown",
        purchaseUrl: plainText(e.priceComment) && /href="([^"]+)"/.exec(e.priceComment ?? "")?.[1] || page,
        priceObservedAt: syncedAt,
        isDemo: false,
      });
  }
  return { events, venues: [...venues.values()], participants: [], offers };
}

export const zaragozaProvider: ProviderAdapter = {
  id: "zaragoza",
  name: "Zaragoza city agenda",
  isDemo: false,
  coverage: "Cultural and leisure events across Zaragoza: museums, theatres, civic centres, libraries and festivals.",
  attribution: "Data: Ayuntamiento de Zaragoza, open data.",
  isConfigured: () => true,
  refreshIntervalMs: 6 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const rows: ZgzEvent[] = [];
    for (let start = 0; start < 20000; start += 500) {
      const json = (await fetchJson("zaragoza", `${API}?rows=500&start=${start}&srsname=wgs84`, ctx, { revalidate: 0, timeoutMs: 60000, headers: { "User-Agent": "OMNIEVENT/1.0 (+https://omnievent.vercel.app)" } })) as { totalCount?: number; result?: ZgzEvent[] };
      rows.push(...(json.result ?? []));
      if (start + 500 >= (json.totalCount ?? 0) || !json.result?.length) break;
      await sleep(300);
    }
    const batch = normalizeZaragoza(rows, syncedAt);
    return { batch, run: { imported: batch.events.length, updated: 0, failures: 0, rateLimited: false, ok: true, finishedAt: new Date().toISOString() } };
  },
};
