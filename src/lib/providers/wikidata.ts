import tzlookup from "@photostructure/tz-lookup";
import { CITIES, slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, keyOf, nearestCityId, zonedDay } from "./common";

/**
 * Wikidata: big events planned years ahead (Olympic and Paralympic Games, world and
 * European championships, finals, Grand Prix, world's fairs, festivals, conventions), from
 * the open knowledge base's public query service. No key needed.
 *
 * - Only events at one known place (not several venues, a country or a region) with a date
 *   known to the day are kept; many future events carry only a year, which would show as
 *   1 January.
 * - Only event kinds from an allow-list are kept, and seasons, stages and similar are left
 *   out, so the list stays to things people can attend.
 * - Dates only: Wikidata rarely knows start times.
 */

const ENDPOINT = "https://query.wikidata.org/sparql";
const UA = "OMNIEVENT/1.0 (https://omnievent.vercel.app)";
const YEARS = 6;

const KEEP = /olympic|paralympic|championship|world cup|cup final|super bowl|grand prix|festival|expo\b|world's fair|exhibition|concert|tournament|\bopen\b|games|marathon|convention|worldcon|eurovision|song contest|ceremony|\bgame\b|\bfinal\b|race|tour de|fair\b|competition|\bmatch\b|sporting event|music event/i;
const DROP = /season|stage|pool play|census|data center|television|year or time period|planned event|future event|election|eclipse|transit|occultation|launch|mission|referendum|legislat|software|holiday|anniversary|qualif/i;

export interface WdItem {
  id: string;
  label: string;
  types: string[];
  place: string;
  lat: number;
  lng: number;
  cc?: string;
  url?: string;
  start?: string;
  end?: string;
}

const regionName = new Intl.DisplayNames(["en"], { type: "region" });

const MAP: [RegExp, string][] = [
  [/olympic|paralympic|multi-sport|games/, "sports"], [/concert|music|song contest|eurovision/, "concerts"], [/festival/, "festivals"],
  [/expo|world's fair|exhibition|horticultural/, "art-exhibitions"], [/convention|worldcon|conference/, "public-lectures"],
  [/championship|cup|bowl|grand prix|tournament|open|marathon|race|tour|match|game|sport|final|competition/, "sports"],
];

export function mapWdCategory(types: string[], label: string): string {
  const t = `${types.join(" ")} ${label}`.toLowerCase();
  for (const [re, slug] of MAP) if (re.test(t)) return slug;
  return "festivals";
}

/** Pure mapping function — unit-tested in tests/wikidata.test.ts. */
export function normalizeWikidata(items: WdItem[], syncedAt: string, now = Date.now()): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  for (const i of items) {
    if (!i.start || /^Q\d+$/.test(i.label) || !Number.isFinite(i.lat) || !Number.isFinite(i.lng)) continue;
    if (!i.types.some((t) => KEEP.test(t)) || i.types.some((t) => DROP.test(t))) continue;
    let tz = "UTC";
    try {
      tz = tzlookup(i.lat, i.lng);
    } catch {
      // keep UTC
    }
    const day0 = i.start.slice(0, 10);
    const day1 = i.end && i.end.slice(0, 10) >= day0 ? i.end.slice(0, 10) : day0;
    const start = zonedDay(day0, tz);
    const end = zonedDay(day1, tz, "23:59");
    if (start === undefined || end === undefined || end < now) continue;
    // Positioned on the event itself (no named venue yet): name the place after the nearest city.
    const cityId = nearestCityId(i.lat, i.lng);
    const place = i.place === i.label ? `${CITIES.find((c) => c.id === cityId)?.name ?? "Host city"} (venue to be confirmed)` : i.place;
    const venueKey = `${place}|${i.lat.toFixed(4)},${i.lng.toFixed(4)}`;
    const venueId = `wd-v-${keyOf(venueKey)}-${slugify(place).slice(0, 40)}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${place}-${keyOf(venueKey)}`),
        name: place,
        city: "",
        cityId,
        country: i.cc ? (regionName.of(i.cc) ?? i.cc) : "",
        countryCode: i.cc ?? "",
        lat: i.lat,
        lng: i.lng,
        timeZone: tz,
        provenance: { provider: "wikidata", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });
    const cat = mapWdCategory(i.types, i.label);
    const multi = day1 !== day0;
    const id = `wd-e-${i.id}`;
    const url = i.url || `https://www.wikidata.org/wiki/${i.id}`;
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${i.label}-${i.id}`),
      title: i.label,
      description: `${i.types.join(", ")} at ${place}.`,
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: multi ? "multi_day" : "single",
      venueId,
      start: new Date(start).toISOString(),
      end: multi ? new Date(end).toISOString() : undefined,
      hoursUnknown: true,
      timeZone: tz,
      status: "scheduled",
      ticketAccess: "unknown",
      isFree: false,
      registrationRequired: false,
      online: false,
      familyFriendly: false,
      officialUrl: url,
      posterHue: hueOf(id),
      participants: [],
      provenance: { provider: "wikidata", externalId: i.id, sourceUrl: `https://www.wikidata.org/wiki/${i.id}`, lastSyncedAt: syncedAt, isDemo: false },
    });
  }
  return { events, venues: [...venues.values()], participants: [], offers: [] };
}

type Binding = Record<string, { value: string } | undefined>;
const point = (wkt?: string) => {
  const m = wkt?.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
  return m ? { lng: Number(m[1]), lat: Number(m[2]) } : undefined;
};

export const wikidataProvider: ProviderAdapter = {
  id: "wikidata",
  name: "Wikidata (big events years ahead)",
  isDemo: false,
  coverage: "Olympic Games, world championships, finals, Grand Prix, world's fairs, festivals and conventions planned up to six years ahead.",
  attribution: "Data: Wikidata (CC0).",
  isConfigured: () => true,
  refreshIntervalMs: 24 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + YEARS * 366 * 86400000).toISOString().slice(0, 10);
    const ask = async (query: string) =>
      ((await fetchJson("wikidata", `${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`, ctx, { revalidate: 0, timeoutMs: 90000, headers: { "User-Agent": UA, Accept: "application/sparql-results+json" } })) as { results?: { bindings?: Binding[] } }).results?.bindings ?? [];
    // 1. Candidates: events dated in the window with a located venue (fast, ignores precision).
    const items = new Map<string, WdItem>();
    const places = new Map<string, Set<string>>();
    for (const prop of ["P580", "P585"]) {
      const rows = await ask(`SELECT ?e ?eLabel ?place ?placeLabel ?areaLabel ?pc ?coord ?cc ?wide ?typeLabel ?site ?article WHERE {
        ?e wdt:${prop} ?d . FILTER(?d > "${from}T00:00:00Z"^^xsd:dateTime && ?d < "${to}T00:00:00Z"^^xsd:dateTime)
        ?e wdt:P31 ?type .
        { ?e wdt:P625 ?coord . OPTIONAL { ?e wdt:P131 ?area } } UNION { ?e wdt:P276 ?place . ?place wdt:P625 ?pc . OPTIONAL { ?place wdt:P17 ?c . ?c wdt:P297 ?cc } OPTIONAL { ?place wdt:P297|wdt:P300 ?wide } }
        OPTIONAL { ?e wdt:P856 ?site }
        OPTIONAL { ?article schema:about ?e ; schema:isPartOf <https://en.wikipedia.org/> }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      } LIMIT 30000`);
      for (const r of rows) {
        const geo = point(r.pc?.value) ?? point(r.coord?.value);
        const qid = r.e?.value.split("/").pop();
        // A country or region as the place means several venues; there's no single spot to show.
        if (!geo || !qid || !r.eLabel || (r.pc && r.wide)) continue;
        const it = items.get(qid) ?? { id: qid, label: r.eLabel.value, types: [], place: r.placeLabel?.value || r.areaLabel?.value || r.eLabel.value, ...geo, cc: r.cc?.value, url: r.site?.value || r.article?.value };
        const type = r.typeLabel?.value;
        if (type && !it.types.includes(type)) it.types.push(type);
        items.set(qid, it);
        if (r.place) places.set(qid, (places.get(qid) ?? new Set()).add(r.place.value));
      }
    }
    // Held at several venues (a tournament across stadiums): no single spot to show.
    for (const [qid, set] of places) if (set.size > 1) items.delete(qid);
    // 2. Dates with their precision, for those candidates only; anything less than a day is dropped.
    const ids = [...items.keys()];
    for (let i = 0; i < ids.length; i += 80) {
      const rows = await ask(`SELECT ?e ?prop ?t ?prec WHERE {
        VALUES ?e { ${ids.slice(i, i + 80).map((q) => `wd:${q}`).join(" ")} }
        VALUES (?prop ?p ?psv) { ("start" p:P580 psv:P580) ("start" p:P585 psv:P585) ("end" p:P582 psv:P582) }
        ?e ?p ?st . ?st ?psv ?v . ?v wikibase:timeValue ?t ; wikibase:timePrecision ?prec .
      }`);
      for (const r of rows) {
        const it = items.get(r.e?.value.split("/").pop() ?? "");
        if (!it || Number(r.prec?.value) < 11 || !r.t) continue;
        if (r.prop?.value === "start" && (!it.start || r.t.value < it.start)) it.start = r.t.value;
        if (r.prop?.value === "end" && (!it.end || r.t.value > it.end)) it.end = r.t.value;
      }
    }
    const batch = normalizeWikidata([...items.values()], syncedAt);
    return { batch, run: { imported: batch.events.length, updated: 0, failures: 0, rateLimited: false, ok: batch.events.length > 0, finishedAt: new Date().toISOString() } };
  },
};
