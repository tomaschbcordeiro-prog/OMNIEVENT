import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, keyOf, nearestCityId, parseLocal, plainText, zonedDay } from "./common";
import type { TribeEvent } from "./venue-calendars";

/**
 * Agendas that Portuguese municipalities publish as open data (dados.gov.pt) or through
 * their website's public events API (The Events Calendar's /wp-json/tribe/events/v1/):
 * small towns and villages whose events appear nowhere else. No key needed.
 *
 * - Ourém and Cantanhede publish JSON feeds; the others use The Events Calendar.
 * - When an event has no venue position, it is shown at the centre of its municipality and
 *   says so (centres from the official municipal boundaries, via geoapi.pt).
 */

const TZ = "Europe/Lisbon";

type Geo = { lat: number; lng: number };
export interface Municipality {
  id: string;
  name: string;
  centre: Geo;
  tribe?: string;
}

export const MUNICIPALITIES: Municipality[] = [
  { id: "arganil", name: "Arganil", centre: { lat: 40.22022, lng: -7.99487 }, tribe: "https://www.cm-arganil.pt" },
  { id: "cantanhede", name: "Cantanhede", centre: { lat: 40.36544, lng: -8.66366 } },
  { id: "celorico-da-beira", name: "Celorico da Beira", centre: { lat: 40.61224, lng: -7.38331 }, tribe: "https://www.cm-celoricodabeira.pt" },
  { id: "figueira-de-castelo-rodrigo", name: "Figueira de Castelo Rodrigo", centre: { lat: 40.89246, lng: -6.9612 }, tribe: "https://www.cm-fcr.pt" },
  { id: "marco-de-canaveses", name: "Marco de Canaveses", centre: { lat: 41.16161, lng: -8.16713 }, tribe: "https://www.cm-marco-canaveses.pt" },
  { id: "ourem", name: "Ourém", centre: { lat: 39.68727, lng: -8.56267 } },
  { id: "santiago-do-cacem", name: "Santiago do Cacém", centre: { lat: 37.93817, lng: -8.55938 }, tribe: "https://www.cm-santiagocacem.pt" },
  { id: "trancoso", name: "Trancoso", centre: { lat: 40.80563, lng: -7.32666 }, tribe: "https://www.cm-trancoso.pt" },
];
const byId = (id: string) => MUNICIPALITIES.find((m) => m.id === id)!;

export interface OuremRow {
  id: string | number;
  data_inicio?: string;
  data_fim?: string;
  nome_atividade?: string;
  horario?: string;
  custo?: string;
  sinopse?: string;
  localizacao?: string;
  fotografia?: string;
}
export interface CantanhedeRow {
  urlExt?: string;
  title?: string;
  data?: string;
  endDate?: string;
  category_name?: string;
  resumo?: string;
  descricao?: string;
  address?: string;
  image?: string;
  mapLatitude?: number | string | null;
  mapLongitude?: number | string | null;
}
type TribeVenue = { venue?: string; address?: string; city?: string; geo_lat?: number | string; geo_lng?: number | string };

const MAP: [RegExp, string][] = [
  [/infantil|crian[cç]a|fam[ií]lia/, "family-shows"], [/exposi[cç]/, "art-exhibitions"], [/concerto|m[uú]sica|fado/, "concerts"],
  [/teatro/, "plays"], [/dan[cç]a/, "dance"], [/cinema|filme/, "cinema"], [/feira|mercado|festa|romaria|arraial/, "street-festivals"],
  [/festival/, "festivals"], [/caminh|percurso|trilho|passeio|visita/, "guided-tours"], [/oficina|workshop|atelier/, "creative-workshops"],
  [/confer[eê]ncia|palestra|apresenta[cç][aã]o|leitura|livro|semin[aá]rio/, "public-lectures"], [/desport|corrida|torneio|futebol|btt|ciclismo/, "sports"],
];

export function mapMunicipalCategory(text: string): string {
  const t = text.toLowerCase();
  for (const [re, slug] of MAP) if (re.test(t)) return slug;
  return "culture";
}

const dmy = (s?: string) => {
  const m = s?.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
};
const decode = (s: string) => s.replace(/&#8211;/g, "–").replace(/&#8220;|&#8221;/g, '"').replace(/&#8217;/g, "’").replace(/&amp;/g, "&").replace(/&#039;|&#39;/g, "'");

interface Draft {
  m: Municipality;
  key: string;
  title: string;
  description?: string;
  day0: string;
  day1: string;
  time?: string;
  venue?: string;
  address?: string;
  geo?: Geo;
  url: string;
  image?: string;
  free?: boolean;
  category: string;
}

function build(drafts: Draft[], syncedAt: string, now: number): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  for (const d of drafts) {
    const start = zonedDay(d.day0, TZ, d.time);
    const end = zonedDay(d.day1, TZ, "23:59");
    if (start === undefined || end === undefined || end < now) continue;
    const placed = d.geo && Number.isFinite(d.geo.lat) && Number.isFinite(d.geo.lng) && d.geo.lat > 36.8 && d.geo.lat < 42.2 && d.geo.lng > -9.6 && d.geo.lng < -6.1 ? d.geo : undefined;
    const geo = placed ?? d.m.centre;
    const name = d.venue?.trim() || d.m.name;
    const venueKey = `${d.m.id}|${name}`;
    const venueId = `ptm-v-${keyOf(venueKey)}-${slugify(name).slice(0, 40)}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${name}-${d.m.name}-${keyOf(venueKey)}`),
        name,
        address: placed ? d.address || undefined : [d.address, `Exact location not given; shown at the centre of ${d.m.name}`].filter(Boolean).join(". "),
        city: d.m.name,
        cityId: nearestCityId(geo.lat, geo.lng),
        country: "Portugal",
        countryCode: "PT",
        lat: geo.lat,
        lng: geo.lng,
        timeZone: TZ,
        provenance: { provider: "pt-municipios", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });
    const multi = d.day1 !== d.day0;
    const id = `ptm-e-${d.m.id}-${keyOf(d.key)}`;
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${d.title}-${d.m.name}-${keyOf(d.key)}`),
      title: d.title,
      description: d.description?.slice(0, 1500),
      categorySlug: d.category,
      groupSlug: groupOf(d.category),
      eventType: multi ? "multi_day" : "single",
      venueId,
      start: new Date(start).toISOString(),
      end: multi ? new Date(end).toISOString() : undefined,
      hoursUnknown: !d.time || undefined,
      timeZone: TZ,
      status: d.free ? "free_entry" : "scheduled",
      ticketAccess: d.free ? "free" : "unknown",
      isFree: !!d.free,
      registrationRequired: false,
      online: false,
      familyFriendly: d.category === "family-shows",
      officialUrl: d.url,
      imageUrl: d.image,
      posterHue: hueOf(d.key),
      participants: [],
      provenance: { provider: "pt-municipios", externalId: d.key, sourceUrl: d.url, lastSyncedAt: syncedAt, isDemo: false },
    });
  }
  return { events, venues: [...venues.values()], participants: [], offers: [] };
}

/** Pure mapping functions — unit-tested in tests/pt-municipios.test.ts. */
export function normalizeOurem(rows: OuremRow[], syncedAt: string, now = Date.now()): ProviderBatch {
  const m = byId("ourem");
  const drafts: Draft[] = [];
  for (const r of rows) {
    const title = plainText(decode(r.nome_atividade ?? ""));
    if (!r.id || !title || !r.data_inicio) continue;
    const hm = r.horario?.slice(0, 5);
    const desc = plainText(r.sinopse);
    drafts.push({
      m,
      key: `ourem:${r.id}`,
      title: title === title.toUpperCase() ? title.charAt(0) + title.slice(1).toLowerCase() : title,
      description: desc,
      day0: r.data_inicio,
      day1: r.data_fim || r.data_inicio,
      time: hm && hm !== "00:00" && r.data_fim === r.data_inicio ? hm : undefined,
      // The feed's position is the council's, not the venue's.
      venue: r.localizacao && !/^munic[ií]pio/i.test(r.localizacao) ? r.localizacao : undefined,
      url: "https://www.ourem.pt/agenda/",
      image: r.fotografia || undefined,
      free: /gratuit|livre/i.test(`${r.custo ?? ""} ${desc ?? ""}`),
      category: mapMunicipalCategory(`${title} ${desc ?? ""}`),
    });
  }
  return build(drafts, syncedAt, now);
}

export function normalizeCantanhede(rows: CantanhedeRow[], syncedAt: string, now = Date.now()): ProviderBatch {
  const m = byId("cantanhede");
  const drafts: Draft[] = [];
  for (const r of rows) {
    const title = plainText(decode(r.title ?? ""));
    const day0 = dmy(r.data);
    if (!title || !r.urlExt || !day0) continue;
    const lat = Number(r.mapLatitude);
    const lng = Number(r.mapLongitude);
    const desc = plainText(decode(r.descricao ?? r.resumo ?? ""));
    drafts.push({
      m,
      key: r.urlExt,
      title,
      description: desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : undefined,
      day0,
      day1: dmy(r.endDate) ?? day0,
      address: plainText(r.address) || undefined,
      geo: r.mapLatitude ? { lat, lng } : undefined,
      url: r.urlExt,
      image: r.image ? `https://www.cm-cantanhede.pt${r.image}` : undefined,
      free: /gratuit|entrada livre/i.test(desc ?? ""),
      category: mapMunicipalCategory(`${r.category_name ?? ""} ${title}`),
    });
  }
  return build(drafts, syncedAt, now);
}

export function normalizeMunicipalTribe(id: string, rows: (TribeEvent & { venue?: TribeVenue | unknown[] })[], syncedAt: string, now = Date.now()): ProviderBatch {
  const m = byId(id);
  const drafts: Draft[] = [];
  for (const r of rows) {
    const title = plainText(decode(r.title ?? ""));
    if (!title || !r.url || !r.start_date) continue;
    const v = (Array.isArray(r.venue) ? undefined : r.venue) as TribeVenue | undefined;
    const day0 = r.start_date.slice(0, 10);
    const day1 = (r.end_date ?? r.start_date).slice(0, 10);
    const hm = r.start_date.slice(11, 16);
    const startAt = parseLocal(r.start_date, TZ);
    drafts.push({
      m,
      key: r.url,
      title,
      description: plainText(r.excerpt || r.description),
      day0,
      day1,
      time: !r.all_day && day0 === day1 && hm && hm !== "00:00" && startAt !== undefined ? hm : undefined,
      venue: v?.venue ? decode(v.venue) : undefined,
      address: [v?.address, v?.city].filter(Boolean).join(", ") || undefined,
      geo: v?.geo_lat ? { lat: Number(v.geo_lat), lng: Number(v.geo_lng) } : undefined,
      url: r.url,
      image: r.image && r.image.url ? r.image.url : undefined,
      free: /gratuit|livre|free/i.test(r.cost ?? ""),
      category: mapMunicipalCategory(`${(r.categories ?? []).map((c) => c.name).join(" ")} ${title}`),
    });
  }
  return build(drafts, syncedAt, now);
}

export const ptMunicipiosProvider: ProviderAdapter = {
  id: "pt-municipios",
  name: "Portuguese municipal agendas",
  isDemo: false,
  coverage: "Events published by Portuguese town councils (Ourém, Cantanhede, Arganil, Celorico da Beira, Figueira de Castelo Rodrigo, Marco de Canaveses, Santiago do Cacém, Trancoso).",
  attribution: "Data: the municipalities' open data and public event feeds.",
  isConfigured: () => true,
  refreshIntervalMs: 12 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const today = new Date().toISOString().slice(0, 10);
    const jobs: Promise<ProviderBatch>[] = [
      fetchJson("pt-municipios", "https://servicos.ourem.pt/api/index.php?service=list_eventos", ctx, { revalidate: 0, timeoutMs: 30000 }).then((j) => normalizeOurem(j as OuremRow[], syncedAt)),
      fetchJson("pt-municipios", "https://cm-cantanhede.pt/mcsite/api/json/agenda", ctx, { revalidate: 0, timeoutMs: 30000 }).then((j) => normalizeCantanhede(j as CantanhedeRow[], syncedAt)),
      ...MUNICIPALITIES.filter((m) => m.tribe).map((m) =>
        fetchJson("pt-municipios", `${m.tribe}/wp-json/tribe/events/v1/events?per_page=50&start_date=${today}`, ctx, { revalidate: 0, timeoutMs: 30000 }).then((j) =>
          normalizeMunicipalTribe(m.id, ((j as { events?: TribeEvent[] }).events ?? []) as TribeEvent[], syncedAt),
        ),
      ),
    ];
    const results = await Promise.allSettled(jobs);
    const ok = results.filter((r): r is PromiseFulfilledResult<ProviderBatch> => r.status === "fulfilled").map((r) => r.value);
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    for (const f of failed) ctx.log("municipal agenda failed", { err: String(f.reason).slice(0, 160) });
    const batch: ProviderBatch = { events: ok.flatMap((b) => b.events), venues: ok.flatMap((b) => b.venues), participants: [], offers: [] };
    return { batch, run: { imported: batch.events.length, updated: 0, failures: failed.length, rateLimited: false, ok: batch.events.length > 0, finishedAt: new Date().toISOString(), error: failed.length ? `${failed.length} of ${jobs.length} agendas failed` : undefined } };
  },
};
