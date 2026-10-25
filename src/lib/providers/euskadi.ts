import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, nearestCityId, parseAmount, plainText, zonedDay } from "./common";
import VENUES from "./data/euskadi-venues.json";

/**
 * Kulturklik, the Basque Government's open culture agenda: concerts, theatre, talks, films,
 * exhibitions, festivals and bertsolaritza across the Basque Country, Navarre and the French
 * Basque Country. No key needed.
 *
 * The feed gives each town's centre, not the venue's position, so venues were located once
 * by name (data/euskadi-venues.json, from scripts/fetch-euskadi-venues.mjs; only results
 * within 8 km of the town sharing a word with the venue's name were kept). Venues we couldn't
 * place, and events that name no venue, are shown at the town centre and say so.
 */

const API = "https://api.euskadi.eus/culture/events/v1.0/events/upcoming";

export interface EusEvent {
  id: string;
  typeEs?: string;
  nameEs?: string;
  startDate?: string;
  endDate?: string;
  openingHoursEs?: string;
  priceEs?: string;
  purchaseUrlEs?: string;
  sourceUrlEs?: string;
  descriptionEs?: string;
  municipalityEs?: string;
  municipalityLatitude?: string | number;
  municipalityLongitude?: string | number;
  provinceNoraCode?: string;
  establishmentEs?: string;
  images?: { imageUrl?: string }[];
}

const TYPES: Record<string, string> = {
  Concierto: "concerts", Teatro: "plays", Conferencia: "public-lectures", "Cine y audiovisuales": "cinema", Exposición: "art-exhibitions",
  Festival: "festivals", Danza: "dance", Formación: "creative-workshops", Bertsolarismo: "traditional", Fiestas: "street-festivals",
  Feria: "street-festivals", Concurso: "culture", "Eventos/jornadas": "culture", Otro: "culture",
};

type Geo = { lat: number; lng: number } | null;

/** Pure mapping function — unit-tested in tests/euskadi.test.ts. */
export function normalizeEuskadi(items: EusEvent[], syncedAt: string, now = Date.now(), table: Record<string, Geo> = VENUES as Record<string, Geo>): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];
  for (const i of items) {
    const tlat = Number(i.municipalityLatitude);
    const tlng = Number(i.municipalityLongitude);
    if (!i.id || !i.nameEs || !Number.isFinite(tlat) || !Number.isFinite(tlng) || tlat === 0) continue;
    const france = i.provinceNoraCode === "-3";
    const tz = france ? "Europe/Paris" : "Europe/Madrid";
    const day0 = i.startDate?.slice(0, 10);
    const day1 = i.endDate?.slice(0, 10) ?? day0;
    if (!day0) continue;
    const hm = i.openingHoursEs?.match(/^(\d{1,2})[:.](\d{2})/);
    const time = hm && Number(hm[1]) < 24 ? `${hm[1].padStart(2, "0")}:${hm[2]}` : undefined;
    const start = zonedDay(day0, tz, time);
    const endDay = zonedDay(day1!, tz, "23:59");
    if (start === undefined || endDay === undefined || endDay < now) continue;
    const multi = day1 !== day0;

    const town = (i.municipalityEs ?? "").split("/")[0].trim();
    const placed = i.establishmentEs ? table[`${i.establishmentEs}|${i.municipalityEs}`] : null;
    const name = i.establishmentEs?.trim() || `${town} (venue not published)`;
    const lat = placed?.lat ?? tlat;
    const lng = placed?.lng ?? tlng;
    const venueKey = `${name}|${i.municipalityEs}`;
    const venueId = `eus-v-${hueOf(venueKey)}-${slugify(name).slice(0, 40)}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${name}-${town}-${hueOf(venueKey)}`),
        name,
        address: placed ? undefined : `Exact location not published; shown at the centre of ${town}`,
        city: town,
        cityId: nearestCityId(lat, lng),
        country: france ? "France" : "Spain",
        countryCode: france ? "FR" : "ES",
        lat,
        lng,
        timeZone: tz,
        provenance: { provider: "euskadi", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });

    const cat = TYPES[i.typeEs ?? ""] ?? "culture";
    const id = `eus-e-${i.id}`;
    const priceText = i.priceEs ?? "";
    const isFree = /^gratis/i.test(priceText);
    const price = isFree ? undefined : parseAmount(priceText);
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${i.nameEs}-${town}-${String(i.id).slice(-6)}`),
      title: plainText(i.nameEs) ?? i.nameEs,
      description: plainText(i.descriptionEs)?.slice(0, 1500),
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: multi ? "multi_day" : "single",
      venueId,
      start: new Date(start).toISOString(),
      end: multi ? new Date(endDay).toISOString() : undefined,
      hoursUnknown: !time || undefined,
      timeZone: tz,
      status: isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? (/inscrip|invitac/i.test(priceText) ? "registration" : "free") : i.purchaseUrlEs || price !== undefined ? "ticketed" : "unknown",
      isFree,
      registrationRequired: /inscrip/i.test(priceText),
      online: false,
      familyFriendly: false,
      officialUrl: i.sourceUrlEs,
      imageUrl: i.images?.[0]?.imageUrl,
      posterHue: hueOf(String(i.id)),
      participants: [],
      provenance: { provider: "euskadi", externalId: String(i.id), sourceUrl: i.sourceUrlEs, lastSyncedAt: syncedAt, isDemo: false },
    });
    if (i.purchaseUrlEs || price !== undefined)
      offers.push({
        id: `${id}-tickets`,
        eventId: id,
        provider: i.purchaseUrlEs ? new URL(i.purchaseUrlEs).hostname.replace(/^www\./, "") : name,
        providerType: "primary",
        ticketCategory: "standard",
        label: price !== undefined ? `Advertised: ${priceText}` : "Tickets",
        basePrice: price,
        currency: price !== undefined ? "EUR" : "",
        availability: "unknown",
        purchaseUrl: i.purchaseUrlEs || i.sourceUrlEs || "https://www.kulturklik.euskadi.eus",
        priceObservedAt: price !== undefined ? syncedAt : undefined,
        isDemo: false,
      });
  }
  return { events, venues: [...venues.values()], participants: [], offers };
}

export const euskadiProvider: ProviderAdapter = {
  id: "euskadi",
  name: "Kulturklik (Basque Country and Navarre)",
  isDemo: false,
  coverage: "Concerts, theatre, talks, films, exhibitions and festivals across the Basque Country, Navarre and the French Basque Country.",
  attribution: "Data: Basque Government, Kulturklik open data.",
  isConfigured: () => true,
  refreshIntervalMs: 3 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const items: EusEvent[] = [];
    for (let page = 1; page <= 100; page++) {
      const json = (await fetchJson("euskadi", `${API}?_elements=100&_page=${page}`, ctx, { revalidate: 0, timeoutMs: 40000 })) as { items?: EusEvent[]; totalPages?: number };
      items.push(...(json.items ?? []));
      if (page >= (json.totalPages ?? 0) || !json.items?.length) break;
    }
    const batch = normalizeEuskadi(items, syncedAt);
    return { batch, run: { imported: batch.events.length, updated: 0, failures: 0, rateLimited: false, ok: true, finishedAt: new Date().toISOString() } };
  },
};
