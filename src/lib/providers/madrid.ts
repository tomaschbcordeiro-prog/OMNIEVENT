import { groupOf } from "../categories";
import { slugify } from "../destinations";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, nearestCityId, parseAmount, parseLocal, plainText } from "./common";

/**
 * Madrid city council cultural agenda (datos.madrid.es, open data, no key).
 *
 * - Dataset 206974: "Actividades culturales y de ocio municipal en los próximos 100 días".
 * - Licence: open data with attribution ("Ayuntamiento de Madrid"), see datos.madrid.es/aviso-legal.
 * - Times are wall-clock times in Madrid. Prices are free text; we only use the first
 *   amount and never claim fees are included.
 */

const URL_DEFAULT = "https://datos.madrid.es/egob/catalogo/206974-0-agenda-eventos-culturales-100.json";
const TZ = "Europe/Madrid";

export interface MadridEvent {
  id?: string;
  "@type"?: string;
  title?: string;
  description?: string;
  free?: number | string;
  price?: string;
  dtstart?: string;
  dtend?: string;
  time?: string;
  link?: string;
  "event-location"?: string;
  audience?: string;
  address?: { area?: { locality?: string; "postal-code"?: string; "street-address"?: string } };
  location?: { latitude?: number; longitude?: number };
  organization?: { "organization-name"?: string; accesibility?: string };
}

// Last path segment of the @type URL → our category slug.
const TYPE_MAP: Record<string, string> = {
  Musica: "concerts", ClasicaEspanola: "classical", CoroGospel: "classical", Flamenco: "traditional",
  JazzSoulFunkySwingReagge: "jazz", LatinaEspanola: "concerts", FolcloreEtnica: "traditional",
  CantautorFolkCountry: "acoustic", RockPop: "rock-metal", Zarzuela: "opera", Opera: "opera",
  TeatroPerformance: "plays", DanzaBaile: "dance", CircoMagia: "circus", ComediaMonologo: "stand-up",
  CuentacuentosTiteresMarionetas: "kids-theatre", ActividadesEscolares: "family", Campamentos: "family",
  Exposiciones: "art-exhibitions", Arte: "art-exhibitions", Historia: "history-exhibitions",
  CineActividadesAudiovisuales: "cinema", ConferenciasColoquios: "public-lectures",
  RecitalesPresentacionesActosLiterarios: "spoken-word", ClubesLectura: "spoken-word", Literatura: "spoken-word",
  CursosTalleres: "creative-workshops", CapacitacionDigital: "creative-workshops", Idiomas: "education",
  ExcursionesItinerariosVisitas: "guided-tours", ItinerariosOtrasActividadesAmbientales: "hiking",
  ActividadesCalleArteUrbano: "street-festivals", Fiestas: "festivals", ActividadesDeportivas: "sports",
  ComemoracionesHomenajes: "heritage", ConcursosCertamenes: "culture", ActosReligiosos: "traditional",
};

export function mapMadridType(t?: string): string {
  const seg = t?.split("/").pop() ?? "";
  return TYPE_MAP[seg] ?? "culture";
}

const DAY = 864e5;

/** Pure mapping function — unit-tested with fixtures in tests/sources.test.ts. */
export function normalizeMadrid(raw: MadridEvent[], syncedAt: string, now = Date.now()): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];

  for (const r of raw) {
    const lat = Number(r.location?.latitude);
    const lng = Number(r.location?.longitude);
    if (!r.id || !r.title || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    const day0 = parseLocal(r.dtstart?.slice(0, 10), TZ);
    if (day0 === undefined) continue;
    const time = r.time && /^\d{1,2}:\d{2}$/.test(r.time) ? r.time : undefined;
    const lastDay = parseLocal(r.dtend?.slice(0, 10), TZ) ?? day0;
    const spanDays = Math.round((lastDay - day0) / DAY);
    const endOfLastDay = parseLocal(`${r.dtend?.slice(0, 10) ?? r.dtstart!.slice(0, 10)} 23:59`, TZ)!;
    if (endOfLastDay < now) continue;

    let start: number;
    let end: number | undefined;
    let eventType: OmniEvent["eventType"] = "single";
    let statusNote: string | undefined;
    if (spanDays >= 1) {
      // Exhibitions and courses running over several days: one listing for the whole run,
      // shown from today when it has already opened.
      eventType = "multi_day";
      const today = parseLocal(new Date(now).toLocaleDateString("en-CA", { timeZone: TZ }), TZ)!;
      start = Math.max(day0, today);
      if (time) start = parseLocal(`${new Date(start).toLocaleDateString("en-CA", { timeZone: TZ })} ${time}`, TZ)!;
      end = endOfLastDay;
      if (day0 < today) statusNote = `Running since ${r.dtstart!.slice(0, 10)}.`;
    } else {
      start = time ? parseLocal(`${r.dtstart!.slice(0, 10)} ${time}`, TZ)! : day0;
      // Without a start time we know only the day, so the listing covers the whole day.
      if (!time) end = endOfLastDay;
    }

    const venueName = r["event-location"]?.trim() || r.organization?.["organization-name"]?.trim() || "Madrid";
    const venueKey = `${slugify(venueName)}-${lat.toFixed(4)}-${lng.toFixed(4)}`;
    const venueId = `mad-v-${venueKey}`;
    if (!venues.has(venueId)) {
      const a = r.address?.area;
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${venueName}-madrid-${lat.toFixed(3)}-${lng.toFixed(3)}`),
        name: venueName,
        address: [a?.["street-address"], a?.["postal-code"]].filter(Boolean).join(", ") || undefined,
        city: "Madrid",
        cityId: nearestCityId(lat, lng),
        country: "Spain",
        countryCode: "ES",
        lat,
        lng,
        timeZone: TZ,
        provenance: { provider: "madrid", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });
    }

    const cat = mapMadridType(r["@type"]);
    const group = groupOf(cat);
    const isFree = String(r.free) === "1";
    const amount = isFree ? undefined : parseAmount(r.price);
    const id = `mad-e-${r.id}`;
    const audience = (r.audience ?? "").toLowerCase();
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${r.title}-${r.id}`),
      title: r.title.trim(),
      description: plainText(r.description) ?? (r.price && !isFree ? `Price: ${r.price}` : undefined),
      categorySlug: cat,
      groupSlug: group,
      eventType,
      venueId,
      hoursUnknown: !time || undefined,
      start: new Date(start).toISOString(),
      end: end !== undefined ? new Date(end).toISOString() : undefined,
      timeZone: TZ,
      status: isFree ? "free_entry" : "scheduled",
      statusNote,
      ticketAccess: isFree ? "free" : r.price ? "ticketed" : "unknown",
      isFree,
      registrationRequired: /inscripci/i.test(r.price ?? ""),
      online: (r["@type"] ?? "").endsWith("/EnLinea"),
      familyFriendly: group === "family" || /niñ|famil|infantil/.test(audience),
      accessibility: r.organization?.accesibility ? ["Accessibility information is listed on the official page."] : undefined,
      officialUrl: r.link,
      posterHue: hueOf(r.id),
      participants: [],
      provenance: { provider: "madrid", externalId: r.id, sourceUrl: r.link, lastSyncedAt: syncedAt, isDemo: false },
    });
    if (r.link) {
      offers.push({
        id: `${id}-info`,
        eventId: id,
        provider: "Ayuntamiento de Madrid",
        providerType: "organizer",
        ticketCategory: "standard",
        label: isFree ? "Free entry, details on madrid.es" : r.price || "Details on madrid.es",
        basePrice: amount,
        currency: amount !== undefined ? "EUR" : "",
        availability: "unknown",
        purchaseUrl: r.link,
        priceObservedAt: amount !== undefined ? syncedAt : undefined,
        isDemo: false,
      });
    }
  }
  return { events, venues: [...venues.values()], participants: [], offers };
}

export const madridProvider: ProviderAdapter = {
  id: "madrid",
  name: "Madrid city cultural agenda (open data)",
  isDemo: false,
  coverage: "Municipal cultural and leisure activities in Madrid for the next 100 days.",
  attribution: "Source: Ayuntamiento de Madrid, datos.madrid.es (open data).",
  isConfigured: () => true,
  refreshIntervalMs: 6 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    // About 2.4 MB, larger than the data cache accepts, so it is fetched directly.
    const json = (await fetchJson("madrid", process.env.MADRID_AGENDA_URL ?? URL_DEFAULT, ctx, { revalidate: 0, timeoutMs: 45000 })) as { "@graph"?: MadridEvent[] };
    const batch = normalizeMadrid((json["@graph"] ?? []).slice(0, ctx.maxEvents), syncedAt);
    return { batch, run: { imported: batch.events.length, updated: 0, failures: 0, rateLimited: false, ok: true, finishedAt: new Date().toISOString() } };
  },
};
