import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, nearestCityId, parseAmount, plainText, sleep, zonedDay } from "./common";

/**
 * Junta de Castilla y León open data: the regional cultural agenda, geolocated, including
 * the activities of every public library down to village libraries. No key needed.
 */

const API = "https://analisis.datosabiertos.jcyl.es/api/explore/v2.1/catalog/datasets/eventos-de-la-agenda-cultural-categorizados-y-geolocalizados/records";
const TZ = "Europe/Madrid";

export interface CylRow {
  id_evento?: string | number;
  titulo?: string;
  descripcion?: string;
  tematica?: string;
  categoria?: string;
  fecha_inicio?: string;
  fecha_fin?: string | null;
  hora_inicio?: string | null;
  precio?: string | null;
  destinatarios?: string | null;
  imagen_evento?: string | null;
  lugar_celebracion?: string | null;
  latitud?: number | string | null;
  longitud?: number | string | null;
  nombre_localidad?: string | null;
  calle?: string | null;
  cp?: string | null;
  enlace_contenido?: string | null;
}

export function mapCylCategory(r: Pick<CylRow, "categoria" | "tematica" | "destinatarios">): string {
  const t = `${r.tematica ?? ""} ${r.categoria ?? ""}`.toLowerCase();
  if (/cuentacuentos|infantil/.test(t) || /familiar|infantil/i.test(r.destinatarios ?? "")) return "family-shows";
  if (/concierto|m[uú]sica/.test(t)) return "concerts";
  if (/teatro/.test(t)) return "plays";
  if (/danza/.test(t)) return "dance";
  if (/cine/.test(t)) return "cinema";
  if (/exposici/.test(t)) return "art-exhibitions";
  if (/taller|curso/.test(t)) return "creative-workshops";
  if (/conferencia|presentaci|club de lectura|libros/.test(t)) return "public-lectures";
  if (/espect[aá]culo/.test(t)) return "plays";
  return "culture";
}

/** Pure mapping function — unit-tested in tests/castilla-leon.test.ts. */
export function normalizeCyl(rows: CylRow[], syncedAt: string, now = Date.now()): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];
  for (const r of rows) {
    const lat = Number(r.latitud);
    const lng = Number(r.longitud);
    if (!r.id_evento || !r.titulo || !r.fecha_inicio || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // Castilla y León's bounds; a position elsewhere is a typo.
    if (lat < 40 || lat > 43.3 || lng < -7.2 || lng > -1.7) continue;
    const day0 = r.fecha_inicio.slice(0, 10);
    const day1 = r.fecha_fin?.slice(0, 10) || day0;
    const time = r.hora_inicio?.match(/^\d{1,2}:\d{2}/)?.[0];
    const start = zonedDay(day0, TZ, time);
    const endDay = zonedDay(day1, TZ, "23:59");
    if (start === undefined || endDay === undefined || endDay < now) continue;
    const multi = day1 !== day0;

    const town = r.nombre_localidad?.trim() ?? "";
    const name = r.lugar_celebracion?.trim() || town;
    const venueKey = `${name}|${lat.toFixed(4)},${lng.toFixed(4)}`;
    const venueId = `cyl-v-${hueOf(venueKey)}-${slugify(name).slice(0, 40)}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${name}-${town}-${hueOf(venueKey)}`),
        name,
        address: [r.calle, r.cp].filter(Boolean).join(", ") || undefined,
        city: town,
        cityId: nearestCityId(lat, lng),
        country: "Spain",
        countryCode: "ES",
        lat,
        lng,
        timeZone: TZ,
        provenance: { provider: "castilla-leon", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });

    const cat = mapCylCategory(r);
    const id = `cyl-e-${r.id_evento}`;
    const priceText = r.precio ?? "";
    const isFree = /gratu/i.test(priceText);
    const price = isFree ? undefined : parseAmount(priceText);
    const desc = plainText(r.descripcion);
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${r.titulo}-${town}-${String(r.id_evento).slice(-6)}`),
      title: plainText(r.titulo)?.replace(/^'(.*)'$/, "$1") ?? r.titulo,
      description: desc?.slice(0, 1500),
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: multi ? "multi_day" : "single",
      venueId,
      start: new Date(start).toISOString(),
      end: multi ? new Date(endDay).toISOString() : undefined,
      hoursUnknown: !time || undefined,
      timeZone: TZ,
      status: isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? "free" : price !== undefined ? "ticketed" : "unknown",
      isFree,
      registrationRequired: /inscripci[oó]n previa|inscribirse/i.test(desc ?? ""),
      online: false,
      familyFriendly: cat === "family-shows",
      officialUrl: r.enlace_contenido ?? undefined,
      imageUrl: r.imagen_evento ?? undefined,
      posterHue: hueOf(String(r.id_evento)),
      participants: [],
      provenance: { provider: "castilla-leon", externalId: String(r.id_evento), sourceUrl: r.enlace_contenido ?? undefined, lastSyncedAt: syncedAt, isDemo: false },
    });
    if (price !== undefined)
      offers.push({
        id: `${id}-price`,
        eventId: id,
        provider: name,
        providerType: "box_office",
        ticketCategory: "standard",
        label: `Advertised: ${priceText}`,
        basePrice: price,
        currency: "EUR",
        availability: "unknown",
        purchaseUrl: r.enlace_contenido ?? "https://cultura.jcyl.es",
        priceObservedAt: syncedAt,
        isDemo: false,
      });
  }
  return { events, venues: [...venues.values()], participants: [], offers };
}

export const castillaLeonProvider: ProviderAdapter = {
  id: "castilla-leon",
  name: "Agenda cultural de Castilla y León",
  isDemo: false,
  coverage: "Cultural activities across Castilla y León, including events at village libraries.",
  attribution: "Data: Junta de Castilla y León, open data.",
  isConfigured: () => true,
  refreshIntervalMs: 6 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const rows: CylRow[] = [];
    for (let offset = 0; offset < 5000; offset += 100) {
      const json = (await fetchJson("castilla-leon", `${API}?limit=100&offset=${offset}`, ctx, { revalidate: 0, timeoutMs: 40000, attempts: 4 })) as { total_count?: number; results?: CylRow[] };
      rows.push(...(json.results ?? []));
      if (offset + 100 >= (json.total_count ?? 0) || !json.results?.length) break;
      await sleep(300);
    }
    const batch = normalizeCyl(rows, syncedAt);
    return { batch, run: { imported: batch.events.length, updated: 0, failures: 0, rateLimited: false, ok: true, finishedAt: new Date().toISOString() } };
  },
};
