import tzlookup from "@photostructure/tz-lookup";
import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, keyOf, nearestCityId, parseAmount, parseLocal, plainText } from "./common";

/**
 * Brazil's state culture departments publish their cultural agendas on Mapas Culturais, an
 * open platform with a public API (no key needed): shows, exhibitions, readings, workshops
 * and festivals, each at a mapped venue ("espaço").
 *
 * - Occurrences of the coming 90 days are read in one request per map; their venues are
 *   then looked up in batches. Events at venues without a position are left out.
 * - Entries whose repeat rule runs for more than a year are standing listings, not events,
 *   and are left out.
 * - The national map is not read: it asks browsers to prove they're human, and many of its
 *   entries are standing listings.
 */

const DAYS = 90;
const UA = "OMNIEVENT/1.0 (+https://omnievent.vercel.app)";

export interface MapaSource {
  id: string;
  host: string;
  name: string;
}

export const MAPS: MapaSource[] = [
  { id: "ce", host: "mapacultural.secult.ce.gov.br", name: "Mapa Cultural do Ceará" },
  { id: "es", host: "mapa.cultura.es.gov.br", name: "Mapa Cultural do Espírito Santo" },
  { id: "pa", host: "mapacultural.pa.gov.br", name: "Mapa Cultural do Pará" },
];

export interface MapaOccurrence {
  event_id?: number;
  name?: string;
  shortDescription?: string | null;
  terms?: { linguagem?: string[]; tag?: string[] } | null;
  classificacaoEtaria?: string | null;
  singleUrl?: string;
  price?: string | null;
  "@files:avatar.avatarBig"?: { url?: string } | null;
  starts_on?: string;
  starts_at?: string;
  ends_on?: string | null;
  ends_at?: string | null;
  rule?: { startsOn?: string; until?: string | null; frequency?: string; price?: string | null } | null;
  space?: { id?: number } | null;
}

export interface MapaSpace {
  id: number;
  name?: string;
  location?: { latitude?: string | number; longitude?: string | number } | null;
  endereco?: string | null;
  En_Municipio?: string | null;
  singleUrl?: string;
}

// First match wins: the event's own words, then its "linguagens" (art forms).
const MAP: [RegExp, string][] = [
  [/contador(es)? de hist|contação|infantil|crianças/, "family-shows"],
  [/música erudita|orquestra|sinfônic|recital/, "classical"],
  [/hip hop|batalha de rima|rap\b/, "hip-hop"],
  [/\bjazz\b/, "jazz"],
  [/exposição|exposicao|mostra de arte/, "art-exhibitions"],
  [/oficina|curso|formação|vivência|ação educativa/, "creative-workshops"],
  [/teatro|espetáculo teatral|peça/, "plays"],
  [/dança|danca/, "dance"],
  [/circ(o|ense)/, "circus"],
  [/cinema|audiovisual|filme|sessão de curtas/, "cinema"],
  [/festival/, "festivals"],
  [/música|show|concerto|sarau/, "concerts"],
  [/palestra|debate|encontro|seminário|roda de conversa|lançamento/, "public-lectures"],
  [/livro|literatura|poesia|leitura/, "spoken-word"],
  [/artes visuais|fotografia/, "art-exhibitions"],
  [/cultura tradicional|cultura indígena|afro-brasileira|quadrilha|maracatu|reisado|capoeira/, "traditional"],
  [/visita (mediada|guiada)/, "guided-tours"],
  [/esporte/, "sports"],
];

export function mapMapaCategory(name: string, terms: string[]): string {
  for (const t of [name.toLowerCase(), terms.join(" ").toLowerCase()]) for (const [re, slug] of MAP) if (re.test(t)) return slug;
  return "culture";
}

const time = (s?: string | null) => (s && /^\d\d:\d\d/.test(s) ? s.slice(0, 5) : undefined);
const DAY = 86400000;

/** Pure mapping function — unit-tested in tests/mapas-culturais.test.ts. */
export function normalizeMapas(source: MapaSource, rows: MapaOccurrence[], spaces: Map<number, MapaSpace>, syncedAt: string, now = Date.now()): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];
  const groups = new Map<string, { o: MapaOccurrence; space: MapaSpace; sessions: { start: number; end?: number; allDay: boolean }[] }>();
  for (const o of rows) {
    const title = plainText(o.name)?.trim();
    const space = o.space?.id ? spaces.get(o.space.id) : undefined;
    if (!o.event_id || !title || !space || !o.starts_on) continue;
    const lat = Number(space.location?.latitude);
    const lng = Number(space.location?.longitude);
    // Brazil only: a venue left at 0,0 or placed abroad by mistake is skipped.
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -34 || lat > 6 || lng < -74 || lng > -28) continue;
    const rule = o.rule ?? {};
    if (rule.startsOn && rule.until && Date.parse(rule.until) - Date.parse(rule.startsOn) > 366 * DAY) continue;
    let tz = "America/Sao_Paulo";
    try {
      tz = tzlookup(lat, lng);
    } catch {
      // keep the default
    }
    const t0 = time(o.starts_at);
    const t1 = time(o.ends_at);
    const start = parseLocal(`${o.starts_on}T${t0 ?? "00:00"}`, tz);
    if (start === undefined) continue;
    const endRaw = t1 ? parseLocal(`${o.ends_on || o.starts_on}T${t1}`, tz) : undefined;
    const end = endRaw !== undefined && endRaw > start ? endRaw : undefined;
    const key = `${o.event_id}|${space.id}`;
    const g = groups.get(key) ?? { o, space, sessions: [] };
    if (!g.sessions.some((s) => s.start === start)) g.sessions.push({ start, end, allDay: !t0 });
    groups.set(key, g);
  }

  for (const [key, { o, space, sessions }] of groups) {
    const future = sessions.filter((s) => (s.end ?? s.start + (s.allDay ? DAY : 3 * 3600000)) >= now).sort((a, b) => a.start - b.start);
    if (!future.length) continue;
    const title = plainText(o.name)!.trim();
    const lat = Number(space.location!.latitude);
    const lng = Number(space.location!.longitude);
    let tz = "America/Sao_Paulo";
    try {
      tz = tzlookup(lat, lng);
    } catch {
      // keep the default
    }
    const place = plainText(space.name)?.trim() || source.name;
    // A town name the address doesn't mention is a data-entry slip ("VALUE") and is left out.
    const town = space.En_Municipio && (!space.endereco || space.endereco.toLowerCase().includes(space.En_Municipio.toLowerCase())) ? space.En_Municipio : "";
    const city = town ? town.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m) => m.toUpperCase()).replace(/\b(De|Da|Do|Das|Dos)\b/g, (w) => w.toLowerCase()) : "";
    const venueId = `mc-v-${source.id}-${space.id}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${place}-${city || source.id}-${space.id}`),
        name: place,
        address: plainText(space.endereco)?.replace(/\s+,/g, ",") || undefined,
        city,
        cityId: nearestCityId(lat, lng),
        country: "Brazil",
        countryCode: "BR",
        lat,
        lng,
        timeZone: tz,
        provenance: { provider: "mapas-culturais", externalId: `${source.host}:space:${space.id}`, sourceUrl: space.singleUrl, lastSyncedAt: syncedAt, isDemo: false },
      });

    const terms = (o.terms?.linguagem ?? []).filter((t) => typeof t === "string");
    const cat = mapMapaCategory(title, terms);
    // Daily sessions over more than a week (an exhibition's opening hours) are one run.
    const s0 = future[0];
    const last = future.at(-1)!;
    const run = future.length > 7 && (o.rule?.frequency === "daily" || last.start - s0.start > 7 * DAY) && cat === "art-exhibitions";
    const priceText = plainText(o.rule?.price ?? o.price ?? "") ?? "";
    const isFree = /gratuit|grátis|gratis|entrada (franca|livre)/i.test(priceText);
    const price = isFree ? undefined : parseAmount(priceText);
    const id = `mc-e-${source.id}-${keyOf(key)}`;
    const url = o.singleUrl || `https://${source.host}/evento/${o.event_id}/`;
    const image = o["@files:avatar.avatarBig"]?.url;
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${title}-${city || source.id}-${keyOf(key)}`),
      title,
      description: [source.name, plainText(o.shortDescription)].filter(Boolean).join(". ").slice(0, 1500),
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: run ? "multi_day" : future.length > 1 ? "recurring" : "single",
      venueId,
      start: new Date(s0.start).toISOString(),
      end: run ? new Date(last.end ?? last.start + DAY).toISOString() : future.length === 1 && s0.end ? new Date(s0.end).toISOString() : undefined,
      schedule: !run && future.length > 1 ? future.slice(1, 200).map((s) => new Date(s.start).toISOString()) : undefined,
      hoursUnknown: s0.allDay || undefined,
      timeZone: tz,
      status: isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? "free" : price !== undefined ? "ticketed" : "unknown",
      isFree,
      registrationRequired: false,
      online: false,
      familyFriendly: cat === "family-shows" || /infantil|crianças|família/i.test(`${title} ${o.shortDescription ?? ""}`),
      officialUrl: url,
      imageUrl: typeof image === "string" && image.startsWith("https://") ? image : undefined,
      posterHue: hueOf(id),
      participants: [],
      provenance: { provider: "mapas-culturais", externalId: `${source.host}:${o.event_id}:${space.id}`, sourceUrl: url, lastSyncedAt: syncedAt, isDemo: false },
    });
    if (price !== undefined)
      offers.push({
        id: `${id}-tickets`,
        eventId: id,
        provider: source.name,
        providerType: "primary",
        ticketCategory: "standard",
        label: `Advertised: ${priceText.slice(0, 80)}`,
        basePrice: price,
        currency: "BRL",
        availability: "unknown",
        purchaseUrl: url,
        priceObservedAt: syncedAt,
        isDemo: false,
      });
  }
  return { events, venues: [...venues.values()], participants: [], offers };
}

const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

export const mapasCulturaisProvider: ProviderAdapter = {
  id: "mapas-culturais",
  name: "Mapas Culturais (Brazil)",
  isDemo: false,
  coverage: "Cultural agendas of Brazilian state culture departments (Ceará, Espírito Santo, Pará): shows, exhibitions, readings and workshops.",
  attribution: "Data: each state's Mapa Cultural (Mapas Culturais, open platform).",
  isConfigured: () => true,
  refreshIntervalMs: 12 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const from = ymd(Date.now());
    const to = ymd(Date.now() + DAYS * DAY);
    const results: ProviderBatch[] = [];
    let failures = 0;
    let lastError = "";
    for (const source of MAPS) {
      try {
        const select = "id,name,shortDescription,terms,classificacaoEtaria,singleUrl,price";
        const url = `https://${source.host}/api/event/findOccurrences?@from=${from}&@to=${to}&@select=${select}&@files=(avatar.avatarBig):url`;
        const rows = (await fetchJson("mapas-culturais", url, ctx, { revalidate: 0, timeoutMs: 90000, headers: { "User-Agent": UA } })) as MapaOccurrence[];
        if (!Array.isArray(rows)) throw new Error("unexpected answer");
        const ids = [...new Set(rows.map((o) => o.space?.id).filter((id): id is number => typeof id === "number"))];
        const spaces = new Map<number, MapaSpace>();
        for (let i = 0; i < ids.length; i += 80) {
          const part = ids.slice(i, i + 80).join(",");
          const list = (await fetchJson("mapas-culturais", `https://${source.host}/api/space/find?@select=id,name,location,endereco,En_Municipio,singleUrl&id=IN(${part})`, ctx, { revalidate: 0, timeoutMs: 60000, headers: { "User-Agent": UA } })) as MapaSpace[];
          for (const s of Array.isArray(list) ? list : []) if (s?.id) spaces.set(s.id, s);
        }
        results.push(normalizeMapas(source, rows, spaces, syncedAt));
      } catch (err) {
        failures++;
        lastError = `${source.host}: ${String(err).slice(0, 120)}`;
        ctx.log("mapa cultural failed", { host: source.host, err: lastError });
      }
    }
    const batch: ProviderBatch = { events: results.flatMap((b) => b.events), venues: results.flatMap((b) => b.venues), participants: [], offers: results.flatMap((b) => b.offers) };
    return {
      batch,
      run: { imported: batch.events.length, updated: 0, failures, rateLimited: false, ok: batch.events.length > 0 || failures === 0, finishedAt: new Date().toISOString(), error: lastError || undefined },
    };
  },
};
