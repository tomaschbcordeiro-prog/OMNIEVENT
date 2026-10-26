import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, nearestCityId, parseAmount, plainText, zonedDay } from "./common";

/**
 * Institut Valencià de Cultura (Generalitat Valenciana open data): theatre, music, dance and
 * film the IVC programmes in its venues across the Valencian Community (Teatre Principal,
 * Rialto, Filmoteca, Palau de les Arts…), each session with its venue's coordinates. No key
 * needed. Sessions of the same title at the same venue become one event with a schedule.
 */

const API = "https://dadesobertes.gva.es/dataset/25cc4d21-e1dd-4d05-b057-dbcc44d4338c/resource/15084e00-c416-4b4d-b229-7a06f4bf07b0/download/lista-de-actividades-culturales-programadas-por-el-ivc.json";
const TZ = "Europe/Madrid";

export interface IvcRow {
  titulo_evento?: string;
  tipo_evento?: string;
  fecha_inicio?: string;
  fecha_fin?: string;
  hora?: string;
  municipio?: string;
  lugar_evento?: string;
  direccion?: string;
  cp?: string;
  precio?: string;
  latitud?: string;
  longitud?: string;
  web?: string;
}

/** The feed is a flat list of one-key objects; each event starts at "titulo_evento". */
export function groupIvc(flat: Record<string, unknown>[]): IvcRow[] {
  const rows: IvcRow[] = [];
  let cur: Record<string, string> | undefined;
  for (const kv of flat) {
    const [k, v] = Object.entries(kv)[0] ?? [];
    if (!k) continue;
    if (k === "titulo_evento") rows.push((cur = {}));
    if (cur && typeof v === "string") cur[k] = v.trim();
  }
  return rows as IvcRow[];
}

const MAP: [RegExp, string][] = [
  [/familiar|infantil/, "family-shows"], [/pel[ií]cula|cine|audiovisual/, "cinema"], [/ópera|opera/, "opera"], [/danza|dansa/, "dance"],
  [/música|musica|concierto|concert/, "concerts"], [/escénic|teatro|teatre/, "plays"], [/exposici/, "art-exhibitions"],
  [/conferencia|charla|jornada/, "public-lectures"], [/taller/, "creative-workshops"],
];

export function mapIvcCategory(type?: string): string {
  const t = (type ?? "").toLowerCase();
  for (const [re, slug] of MAP) if (re.test(t)) return slug;
  return "culture";
}

const ymd = (dmy?: string) => {
  const m = dmy?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
};
/** "18:00", ", D - 18 h", "20.30 h" → "HH:MM" when there is exactly one time. */
export function ivcTime(s?: string): string | undefined {
  if (/\d\s*(?:a|-|–)\s*\d/.test(s ?? "")) return undefined;
  const all = [...(s ?? "").matchAll(/(\d{1,2})(?:[:.](\d{2}))?\s*(?:h\b|$)/g)].filter((m) => Number(m[1]) < 24);
  if (all.length !== 1) return undefined;
  return `${all[0][1].padStart(2, "0")}:${all[0][2] ?? "00"}`;
}

/** Pure mapping function — unit-tested in tests/valencia-ivc.test.ts. */
export function normalizeIvc(rows: IvcRow[], syncedAt: string, now = Date.now()): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];
  const groups = new Map<string, { row: IvcRow; sessions: { start: number; end: number; timed: boolean }[] }>();
  for (const r of rows) {
    const title = plainText(r.titulo_evento);
    const lat = Number(r.latitud);
    const lng = Number(r.longitud);
    if (!title || /^\(?cancel/i.test(title) || !r.latitud || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // The Valencian Community.
    if (lat < 37.8 || lat > 40.8 || lng < -1.6 || lng > 0.7) continue;
    const day0 = ymd(r.fecha_inicio);
    const day1 = ymd(r.fecha_fin) ?? day0;
    if (!day0 || !day1) continue;
    const time = day0 === day1 ? ivcTime(r.hora) : undefined;
    const start = zonedDay(day0, TZ, time);
    const end = zonedDay(day1, TZ, "23:59");
    if (start === undefined || end === undefined || end < now) continue;
    const key = `${r.web || title}|${r.lugar_evento}`;
    const g = groups.get(key) ?? { row: r, sessions: [] };
    if (!g.sessions.some((s) => s.start === start)) g.sessions.push({ start, end, timed: !!time });
    groups.set(key, g);
  }
  for (const [key, { row: r, sessions }] of groups) {
    sessions.sort((a, b) => a.start - b.start);
    const first = sessions[0];
    const title = plainText(r.titulo_evento)!;
    const lat = Number(r.latitud);
    const lng = Number(r.longitud);
    const name = r.lugar_evento?.trim() || r.municipio?.trim() || "IVC";
    const venueKey = `${name}|${lat.toFixed(3)},${lng.toFixed(3)}`;
    const venueId = `ivc-v-${hueOf(venueKey)}-${slugify(name).slice(0, 40)}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${name}-${r.municipio ?? ""}-${hueOf(venueKey)}`),
        name,
        address: r.direccion?.trim() || undefined,
        city: r.municipio?.trim() || "València",
        cityId: nearestCityId(lat, lng),
        country: "Spain",
        countryCode: "ES",
        lat,
        lng,
        timeZone: TZ,
        provenance: { provider: "valencia-ivc", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });
    const cat = mapIvcCategory(r.tipo_evento);
    const multi = first.end - first.start > 36 * 3600000;
    const priceText = r.precio?.trim() ?? "";
    const isFree = /gratu|lliure|libre/i.test(priceText);
    const price = isFree ? undefined : parseAmount(priceText);
    const id = `ivc-e-${hueOf(key)}-${slugify(title).slice(0, 30)}`;
    const url = r.web?.startsWith("http") ? r.web : "https://ivc.gva.es";
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${title}-${hueOf(key)}`),
      title,
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: multi ? "multi_day" : sessions.length > 1 ? "recurring" : "single",
      venueId,
      start: new Date(first.start).toISOString(),
      end: multi ? new Date(first.end).toISOString() : undefined,
      schedule: !multi && sessions.length > 1 ? sessions.slice(1).map((s) => new Date(s.start).toISOString()) : undefined,
      hoursUnknown: !first.timed || undefined,
      timeZone: TZ,
      status: isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? "free" : price !== undefined ? "ticketed" : "unknown",
      isFree,
      registrationRequired: false,
      online: false,
      familyFriendly: cat === "family-shows",
      officialUrl: url,
      posterHue: hueOf(key),
      participants: [],
      provenance: { provider: "valencia-ivc", externalId: key, sourceUrl: url, lastSyncedAt: syncedAt, isDemo: false },
    });
    if (price !== undefined)
      offers.push({
        id: `${id}-tickets`,
        eventId: id,
        provider: "Institut Valencià de Cultura",
        providerType: "primary",
        ticketCategory: "standard",
        label: `Advertised: ${priceText.slice(0, 80)}`,
        basePrice: price,
        currency: "EUR",
        availability: "unknown",
        purchaseUrl: url,
        priceObservedAt: syncedAt,
        isDemo: false,
      });
  }
  return { events, venues: [...venues.values()], participants: [], offers };
}

export const valenciaIvcProvider: ProviderAdapter = {
  id: "valencia-ivc",
  name: "Institut Valencià de Cultura",
  isDemo: false,
  coverage: "Theatre, music, dance and film programmed by the IVC across the Valencian Community.",
  attribution: "Data: Generalitat Valenciana open data (Institut Valencià de Cultura), CC BY 4.0.",
  isConfigured: () => true,
  refreshIntervalMs: 12 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const json = (await fetchJson("valencia-ivc", API, ctx, { revalidate: 0, timeoutMs: 60000 })) as { data?: Record<string, unknown>[] };
    const batch = normalizeIvc(groupIvc(json.data ?? []), syncedAt);
    return { batch, run: { imported: batch.events.length, updated: 0, failures: 0, rateLimited: false, ok: batch.events.length > 0, finishedAt: new Date().toISOString() } };
  },
};
