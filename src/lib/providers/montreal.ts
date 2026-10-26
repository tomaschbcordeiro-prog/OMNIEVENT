import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, keyOf, nearestCityId, plainText, zonedDay } from "./common";

/**
 * Ville de Montréal open data, "Événements publics": activities in libraries, cultural
 * centres, parks and boroughs (shows, exhibitions, story times, workshops, sports), with
 * coordinates. Dates only. Council meetings are left out. No key needed.
 */

const API = "https://donnees.montreal.ca/dataset/6a4cbf2c-c9b7-413a-86b1-e8f7081e2578/resource/35307457-a00f-4912-9941-8095ead51f6e/download/evenements.geojson";
const TZ = "America/Toronto";

export interface MtlProps {
  titre?: string;
  url_fiche?: string;
  description?: string;
  date_debut?: string;
  date_fin?: string;
  type_evenement?: string;
  public_cible?: string;
  emplacement?: string;
  inscription?: string;
  cout?: string;
  arrondissement?: string;
  titre_adresse?: string;
  adresse_principale?: string;
  code_postal?: string;
  lat?: number | string;
  long?: number | string;
}

const MAP: [RegExp, string][] = [
  [/heure du conte|enfant|famille/, "family-shows"], [/humour/, "stand-up"], [/musique/, "concerts"], [/théâtre|theatre/, "plays"], [/danse/, "dance"],
  [/cinéma|film/, "cinema"], [/exposition/, "art-exhibitions"], [/art et artisanat|atelier/, "creative-workshops"],
  [/conférence|club de lecture|littérature/, "public-lectures"], [/sport|plein air/, "sports"], [/visite/, "guided-tours"],
  [/festival|fête/, "festivals"], [/science/, "science-exhibitions"],
];

export function mapMtlCategory(type?: string, audience?: string): string {
  const t = `${type ?? ""} ${audience ?? ""}`.toLowerCase();
  for (const [re, slug] of MAP) if (re.test(t)) return slug;
  return "culture";
}

const clean = (s?: string) => (s && s !== "nan" ? s.trim() : undefined);

/** Pure mapping function — unit-tested in tests/montreal.test.ts. */
export function normalizeMontreal(rows: MtlProps[], syncedAt: string, now = Date.now()): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const seen = new Set<string>();
  for (const r of rows) {
    const lat = Number(r.lat);
    const lng = Number(r.long);
    const title = clean(r.titre);
    if (!title || !r.url_fiche || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < 45.3 || lat > 45.8 || lng < -74.1 || lng > -73.4) continue;
    if (/conseil|comité/i.test(r.type_evenement ?? "") || /^en ligne/i.test(r.emplacement ?? "")) continue;
    const day0 = r.date_debut?.slice(0, 10);
    const day1 = r.date_fin?.slice(0, 10) || day0;
    if (!day0) continue;
    const start = zonedDay(day0, TZ);
    const endDay = zonedDay(day1!, TZ, "23:59");
    if (start === undefined || endDay === undefined || endDay < now) continue;
    const key = `${r.url_fiche}|${day0}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const place = clean(r.titre_adresse) ?? clean(r.arrondissement) ?? "Montréal";
    const venueKey = `${place}|${lat.toFixed(4)},${lng.toFixed(4)}`;
    const venueId = `mtl-v-${keyOf(venueKey)}-${slugify(place).slice(0, 40)}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${place}-montreal-${keyOf(venueKey)}`),
        name: place,
        address: [clean(r.adresse_principale), clean(r.code_postal)].filter(Boolean).join(", ") || clean(r.arrondissement),
        city: "Montréal",
        cityId: nearestCityId(lat, lng),
        country: "Canada",
        countryCode: "CA",
        lat,
        lng,
        timeZone: TZ,
        provenance: { provider: "montreal", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });
    const cat = mapMtlCategory(r.type_evenement, r.public_cible);
    const isFree = /gratuit/i.test(r.cout ?? "");
    const id = `mtl-e-${keyOf(key)}-${slugify(title).slice(0, 30)}`;
    const multi = day1 !== day0;
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${title}-montreal-${keyOf(key)}`),
      title,
      description: plainText(r.description)?.slice(0, 1500),
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: multi ? "multi_day" : "single",
      venueId,
      start: new Date(start).toISOString(),
      end: multi ? new Date(endDay).toISOString() : undefined,
      hoursUnknown: true,
      timeZone: TZ,
      status: isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? (/inscription/i.test(r.inscription ?? "") ? "registration" : "free") : "unknown",
      isFree,
      registrationRequired: /inscription/i.test(r.inscription ?? "") && !/libre/i.test(r.inscription ?? ""),
      online: false,
      familyFriendly: cat === "family-shows" || /famille|enfant/i.test(r.public_cible ?? ""),
      officialUrl: r.url_fiche,
      posterHue: hueOf(key),
      participants: [],
      provenance: { provider: "montreal", externalId: key, sourceUrl: r.url_fiche, lastSyncedAt: syncedAt, isDemo: false },
    });
  }
  return { events, venues: [...venues.values()], participants: [], offers: [] };
}

export const montrealProvider: ProviderAdapter = {
  id: "montreal",
  name: "Ville de Montréal events",
  isDemo: false,
  coverage: "Public events in Montréal's libraries, cultural centres, parks and boroughs.",
  attribution: "Data: Ville de Montréal, open data (CC BY 4.0).",
  isConfigured: () => true,
  refreshIntervalMs: 12 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    // The portal refuses requests without a browser-like user agent.
    const json = (await fetchJson("montreal", API, ctx, { revalidate: 0, timeoutMs: 90000, headers: { "User-Agent": "Mozilla/5.0 (compatible; OMNIEVENT/1.0; +https://omnievent.vercel.app)" } })) as { features?: { properties?: MtlProps }[] };
    const batch = normalizeMontreal((json.features ?? []).map((f) => f.properties ?? {}), syncedAt);
    return { batch, run: { imported: batch.events.length, updated: 0, failures: 0, rateLimited: false, ok: true, finishedAt: new Date().toISOString() } };
  },
};
