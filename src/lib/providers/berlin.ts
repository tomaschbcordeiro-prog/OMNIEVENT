import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, nearestCityId, plainText, zonedDay } from "./common";
import VENUES from "./data/berlin-venues.json";

/**
 * kulturdaten.berlin: Berlin's open culture data (the districts' event calendars, museums,
 * libraries, theatres). No key needed. Venues have addresses but no coordinates, so they were
 * located from street and postcode (data/berlin-venues.json, scripts/fetch-berlin-venues.mjs;
 * only matches in Berlin with the same postcode were kept). Events at venues we couldn't
 * place are skipped. Non-cultural entries (police info stands, consultation hours, meetings)
 * are left out.
 */

const API = "https://api-v2.kulturdaten.berlin/api/events";
const TZ = "Europe/Berlin";

type Ref = { referenceId?: string; referenceLabel?: { de?: string; en?: string } };
export interface BerlinEvent {
  identifier: string;
  schedule?: { startDate?: string; endDate?: string; startTime?: string; endTime?: string };
  attractions?: Ref[];
  locations?: Ref[];
  admission?: { ticketType?: string };
  scheduleStatus?: string;
  status?: string;
}

const NOT_CULTURE = /mobilen? wache|polizei|sprechstunde|beratung|sitzung|ausschuss|bürgeramt|impf|blutspende|stammtisch/i;

const MAP: [RegExp, string][] = [
  [/kinder|familie|kita|märchen|puppen/, "family-shows"], [/konzert|musik|chor|orchester/, "concerts"], [/theater|bühne/, "plays"],
  [/tanz/, "dance"], [/kino|film/, "cinema"], [/ausstellung|galerie|vernissage/, "art-exhibitions"], [/lesung|vortrag|gespräch|diskussion/, "public-lectures"],
  [/führung|rundgang|spaziergang/, "guided-tours"], [/workshop|werkstatt|kurs|basteln/, "creative-workshops"], [/festival|fest\b/, "festivals"],
  [/markt|flohmarkt/, "street-festivals"], [/sport|lauf/, "sports"],
];

export function mapBerlinCategory(title: string): string {
  const t = title.toLowerCase();
  for (const [re, slug] of MAP) if (re.test(t)) return slug;
  return "culture";
}

const label = (r?: Ref) => (r?.referenceLabel?.de ?? r?.referenceLabel?.en)?.trim();
type Geo = { lat: number; lng: number } | null;

/** Pure mapping function — unit-tested in tests/berlin.test.ts. */
export function normalizeBerlin(rows: BerlinEvent[], syncedAt: string, now = Date.now(), table: Record<string, Geo> = VENUES as Record<string, Geo>): ProviderBatch & { unplaced: number } {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  let unplaced = 0;
  for (const e of rows) {
    const title = plainText(label(e.attractions?.[0]));
    const loc = e.locations?.[0];
    if (!title || !loc?.referenceId || NOT_CULTURE.test(title)) continue;
    if (e.scheduleStatus && /cancel/i.test(e.scheduleStatus)) continue;
    const geo = table[loc.referenceId];
    if (!geo) {
      unplaced++;
      continue;
    }
    const s = e.schedule ?? {};
    const day0 = s.startDate?.slice(0, 10);
    const day1 = s.endDate?.slice(0, 10) || day0;
    if (!day0) continue;
    const hm = s.startTime?.slice(0, 5);
    const hasTime = !!hm && hm !== "00:00";
    const start = zonedDay(day0, TZ, hasTime ? hm : undefined);
    const endHm = s.endTime?.slice(0, 5);
    const end = endHm && endHm !== "00:00" ? zonedDay(day1!, TZ, endHm) : zonedDay(day1!, TZ, "23:59");
    if (start === undefined || end === undefined || end < now) continue;
    const multi = day1 !== day0;

    const name = label(loc) ?? "Berlin";
    const venueId = `ber-v-${loc.referenceId}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${name}-berlin-${hueOf(loc.referenceId)}`),
        name,
        city: "Berlin",
        cityId: nearestCityId(geo.lat, geo.lng),
        country: "Germany",
        countryCode: "DE",
        lat: geo.lat,
        lng: geo.lng,
        timeZone: TZ,
        provenance: { provider: "berlin", externalId: loc.referenceId, lastSyncedAt: syncedAt, isDemo: false },
      });
    const cat = mapBerlinCategory(title);
    const isFree = /freeOfCharge/i.test(e.admission?.ticketType ?? "");
    const id = `ber-e-${e.identifier}`;
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${title}-berlin-${e.identifier.slice(-6)}`),
      title,
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: multi ? "multi_day" : "single",
      venueId,
      start: new Date(start).toISOString(),
      end: multi || (endHm && endHm !== "00:00") ? new Date(end).toISOString() : undefined,
      hoursUnknown: !hasTime || undefined,
      timeZone: TZ,
      status: isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? "free" : "unknown",
      isFree,
      registrationRequired: false,
      online: false,
      familyFriendly: cat === "family-shows",
      officialUrl: `https://kulturdaten.berlin/events/${e.identifier}`,
      posterHue: hueOf(e.identifier),
      participants: [],
      provenance: { provider: "berlin", externalId: e.identifier, lastSyncedAt: syncedAt, isDemo: false },
    });
  }
  return { events, venues: [...venues.values()], participants: [], offers: [], unplaced };
}

export const berlinProvider: ProviderAdapter = {
  id: "berlin",
  name: "kulturdaten.berlin",
  isDemo: false,
  coverage: "Cultural events across Berlin's districts: museums, libraries, theatres, galleries and neighbourhood venues.",
  attribution: "Data: kulturdaten.berlin (Technologiestiftung Berlin), open data.",
  isConfigured: () => true,
  refreshIntervalMs: 6 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const today = new Date().toISOString().slice(0, 10);
    const url = (page: number) => `${API}?pageSize=500&page=${page}&startDate=${today}`;
    const first = (await fetchJson("berlin", url(1), ctx, { revalidate: 0, timeoutMs: 60000 })) as { data?: { totalCount?: number; events?: BerlinEvent[] } };
    const rows: BerlinEvent[] = [...(first.data?.events ?? [])];
    const pages = Math.min(100, Math.ceil((first.data?.totalCount ?? 0) / 500));
    const queue = Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2);
    let failures = 0;
    const worker = async () => {
      while (queue.length) {
        const page = queue.shift()!;
        try {
          const json = (await fetchJson("berlin", url(page), ctx, { revalidate: 0, timeoutMs: 60000 })) as { data?: { events?: BerlinEvent[] } };
          rows.push(...(json.data?.events ?? []));
        } catch (err) {
          failures++;
          ctx.log("berlin page failed", { page, err: String(err) });
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    const { unplaced, ...batch } = normalizeBerlin(rows, syncedAt);
    if (unplaced) ctx.log("berlin events at venues not located", { unplaced });
    return { batch, run: { imported: batch.events.length, updated: 0, failures, rateLimited: false, ok: batch.events.length > 0, finishedAt: new Date().toISOString(), error: failures ? `${failures} of ${pages} pages failed` : undefined } };
  },
};
