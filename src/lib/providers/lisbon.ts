import { groupOf } from "../categories";
import { slugify } from "../destinations";
import { haversineKm } from "../geo";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch, SyncContext } from "./types";
import { fetchJson, hueOf, nearestCityId, parseLocal, plainText, sleep } from "./common";
import KNOWN_VENUES from "./data/lisbon-venues.json";
import SNAPSHOT from "./data/lisbon-events.json";

/**
 * Agenda Cultural de Lisboa (agendalx.pt), the City of Lisbon's cultural agenda.
 *
 * - Official public API, no key: https://www.agendalx.pt/api/ (50 events per page).
 * - Published as open data by Câmara Municipal de Lisboa under CC BY 4.0
 *   (dados.cm-lisboa.pt, dataset "Agenda Cultural de Lisboa"). Attribution required.
 * - Venues come without coordinates. `data/lisbon-venues.json` holds venues located once
 *   from OpenStreetMap and checked by hand; new venues are looked up at sync time and kept
 *   only when the place name clearly matches. Events at venues we can't place are skipped.
 * - The API refuses some cloud networks (Vercel gets HTTP 403). A daily snapshot saved by
 *   .github/workflows/lisbon-snapshot.yml (scripts/fetch-lisbon.mjs) is used when it does.
 * - Times are given per weekday ("sex: 21h; sáb: 21h30") alongside a list of dates.
 */

const BASE = "https://www.agendalx.pt/wp-json/agendalx/v1/events";
const TZ = "Europe/Lisbon";
// Identifies us as the agenda asks. (Their firewall rejects some user-agent wordings with HTTP 520.)
const UA = "OMNIEVENT/1.0 (+https://omnievent.vercel.app)";
const LISBON = { lat: 38.7223, lng: -9.1393 };

type Term = { id?: number; slug?: string; name?: string };
export interface AlxEvent {
  id: number;
  title?: { rendered?: string };
  featured_media_large?: string;
  subtitle?: string | string[];
  subject?: string;
  string_dates?: string | string[];
  string_times?: string;
  description?: string | string[];
  venue?: Record<string, Term> | false | [];
  categories_name_list?: Record<string, Term> | [];
  tags_name_list?: Record<string, Term> | [];
  link?: string;
  occurences?: string[];
  StartDate?: string;
  LastDate?: string;
  price_cat?: string | string[];
  price_val?: string | string[];
}

const CATEGORY_MAP: Record<string, string> = {
  musica: "concerts", teatro: "plays", artes: "art-exhibitions", "visitas-guiadas": "guided-tours", cinema: "cinema",
  ciencias: "science-exhibitions", literatura: "spoken-word", "stand-up-comedy": "stand-up", feiras: "street-festivals",
  danca: "dance", infantil: "family-shows", criancas: "family-shows", festivais: "festivals",
};
// The free-text subject is often more specific than the category.
const SUBJECT_MAP: [RegExp, string][] = [
  [/jazz/, "jazz"], [/fado/, "traditional"], [/[óo]pera/, "opera"], [/cl[áa]ssica|orquestra|sinf[óo]nic/, "classical"],
  [/eletr[óo]nica|electr[óo]nica|dj/, "electronic"], [/rock|metal/, "rock-metal"], [/hip[- ]?hop|rap\b/, "hip-hop"],
  [/stand-?up|com[ée]dia|humor/, "stand-up"], [/circo/, "circus"], [/marioneta|fantoche/, "kids-theatre"],
  [/dan[çc]a|ballet|bailado/, "dance"], [/musical/, "musicals"], [/fotografia/, "photography"],
  [/confer[êe]ncia|palestra|debate|col[óo]quio/, "public-lectures"], [/workshop|oficina|atelier/, "creative-workshops"],
  [/festival/, "festivals"], [/exposi[çc][ãa]o/, "art-exhibitions"],
];

export function mapLisbonCategory(e: Pick<AlxEvent, "categories_name_list" | "subject">): string {
  const subject = (e.subject ?? "").toLowerCase();
  for (const [re, slug] of SUBJECT_MAP) if (re.test(subject)) return slug;
  const cats = e.categories_name_list && !Array.isArray(e.categories_name_list) ? Object.keys(e.categories_name_list) : [];
  for (const c of cats) if (CATEGORY_MAP[c]) return CATEGORY_MAP[c];
  return "culture";
}

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const norm = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** "sáb e dom" → [6, 0]; "seg a sex" → Monday to Friday. */
function weekdayList(days: string): number[] {
  const range = days.match(/\b(dom|seg|ter|qua|qui|sex|sab)\w*\s+a\s+(dom|seg|ter|qua|qui|sex|sab)/);
  if (range) {
    const out: number[] = [];
    for (let i = WEEKDAYS.indexOf(range[1]); ; i = (i + 1) % 7) {
      out.push(i);
      if (i === WEEKDAYS.indexOf(range[2]) || out.length > 7) break;
    }
    return out;
  }
  return [...days.matchAll(/\b(dom|seg|ter|qua|qui|sex|sab)/g)].map((m) => WEEKDAYS.indexOf(m[1]));
}

/**
 * "21h30" → every date at 21:30. "sex: 21h; sáb: 16h, 21h" → per weekday.
 * Returns null when no usable time is given ("vários horários", blank).
 */
export function parseTimes(s?: string): { all?: string[]; byDay?: Record<number, string[]> } | null {
  const t = norm(s ?? "").trim();
  if (!t) return null;
  const hm = (x: string) => [...x.matchAll(/(\d{1,2})h(\d{2})?/g)].map((m) => `${m[1].padStart(2, "0")}:${m[2] ?? "00"}`);
  if (!t.includes(":")) {
    const all = hm(t);
    return all.length ? { all } : null;
  }
  const byDay: Record<number, string[]> = {};
  for (const part of t.split(";")) {
    const [days, times] = part.split(":");
    const list = hm(times ?? "");
    if (!list.length) continue;
    for (const i of weekdayList(days ?? "")) byDay[i] = list;
  }
  return Object.keys(byDay).length ? { byDay } : null;
}

/** Amounts from the PHP-serialised price list, e.g. a:1:{i:0;a:2:{s:5:"value";s:1:"5";…}}. */
export function parsePrices(raw?: string | string[]): { amounts: number[]; notes: string[] } {
  const s = Array.isArray(raw) ? raw.join("") : raw ?? "";
  const amounts: number[] = [];
  const notes: string[] = [];
  for (const m of s.matchAll(/s:\d+:"(value|description)";s:\d+:"([^"]*)"/g)) {
    if (m[1] === "description") notes.push(m[2].trim());
    else for (const n of m[2].matchAll(/\d+(?:[.,]\d{1,2})?/g)) amounts.push(Number(n[0].replace(",", ".")));
  }
  return { amounts: amounts.filter((n) => Number.isFinite(n)), notes: notes.filter(Boolean) };
}

const first = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v) ?? "";
const decode = (s: string) => plainText(s) ?? s;

export type VenueLocation = { name: string; lat: number; lng: number };
const known = KNOWN_VENUES as Record<string, VenueLocation>;

/** Pure mapping function — unit-tested with fixtures in tests/lisbon.test.ts. */
export function normalizeLisbon(raw: AlxEvent[], syncedAt: string, located: Record<string, VenueLocation> = known, now = Date.now()): ProviderBatch & { unplaced: number } {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];
  let unplaced = 0;
  const today = new Date(now).toLocaleDateString("en-CA", { timeZone: TZ });
  const seen = new Set<number>();

  for (const r of raw) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const title = decode(r.title?.rendered ?? "").trim();
    const venueEntry = r.venue && !Array.isArray(r.venue) ? Object.entries(r.venue)[0] : undefined;
    if (!title || !venueEntry) {
      unplaced++;
      continue;
    }
    const [venueSlug, venueTerm] = venueEntry;
    const loc = located[venueSlug];
    if (!loc) {
      unplaced++;
      continue;
    }

    // Upcoming dates; fall back to the start/end range when no list is given.
    let dates = (r.occurences ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today).sort();
    const rangeOnly = !dates.length;
    if (rangeOnly) {
      const last = r.LastDate && r.LastDate >= today ? r.LastDate : undefined;
      if (!last) continue;
      dates = [r.StartDate && r.StartDate > today ? r.StartDate : today, last];
    }
    const times = parseTimes(r.string_times);
    const sessions: number[] = [];
    if (times && !rangeOnly) {
      for (const d of dates) {
        const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
        for (const hm of times.all ?? times.byDay?.[wd] ?? []) {
          const t = parseLocal(`${d} ${hm}`, TZ);
          if (t !== undefined && t > now - 3600000) sessions.push(t);
        }
      }
    }
    sessions.sort((a, b) => a - b);

    let start: number;
    let end: number | undefined;
    let schedule: string[] | undefined;
    let eventType: OmniEvent["eventType"] = "single";
    let hoursUnknown: true | undefined;
    let durationMinutes: number | undefined;
    if (sessions.length) {
      start = sessions[0];
      if (sessions.length > 1) {
        eventType = "recurring";
        schedule = sessions.slice(1, 150).map((t) => new Date(t).toISOString());
      }
    } else if (rangeOnly || dates.length > 60) {
      // A continuous run (exhibitions): one listing for the whole period.
      hoursUnknown = true;
      start = parseLocal(dates[0], TZ)!;
      end = parseLocal(`${dates[dates.length - 1]} 23:59`, TZ)!;
      eventType = dates[0] === dates[dates.length - 1] ? "single" : "multi_day";
    } else {
      // Specific dates without times: each date covers the whole day.
      hoursUnknown = true;
      durationMinutes = 1439;
      const days = dates.map((d) => parseLocal(d, TZ)!).filter((t) => t !== undefined);
      start = days[0];
      if (days.length > 1) {
        eventType = "recurring";
        schedule = days.slice(1, 150).map((t) => new Date(t).toISOString());
      }
    }

    const venueId = `alx-v-${venueSlug}`;
    if (!venues.has(venueId)) {
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${venueTerm.name ?? venueSlug}-lisboa`),
        name: decode(venueTerm.name ?? loc.name),
        city: "Lisbon",
        cityId: nearestCityId(loc.lat, loc.lng) ?? "lisbon",
        country: "Portugal",
        countryCode: "PT",
        lat: loc.lat,
        lng: loc.lng,
        timeZone: TZ,
        provenance: { provider: "lisbon", externalId: venueSlug, lastSyncedAt: syncedAt, isDemo: false },
      });
    }

    const tags = r.tags_name_list && !Array.isArray(r.tags_name_list) ? Object.keys(r.tags_name_list) : [];
    const priceCat = first(r.price_cat);
    const { amounts, notes } = parsePrices(r.price_val);
    const isFree = priceCat === "free" || tags.includes("gratuito");
    const cat = mapLisbonCategory(r);
    const group = groupOf(cat);
    const id = `alx-e-${r.id}`;
    const subtitle = first(r.subtitle);
    const description = [subtitle && decode(subtitle), plainText(first(r.description)), notes.length ? `Prices: ${notes.join("; ")}` : ""].filter(Boolean).join("\n\n");
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${title}-alx${r.id}`),
      title,
      description: description || undefined,
      categorySlug: cat,
      groupSlug: group,
      eventType,
      venueId,
      start: new Date(start).toISOString(),
      end: end !== undefined ? new Date(end).toISOString() : undefined,
      durationMinutes,
      schedule,
      hoursUnknown,
      timeZone: TZ,
      status: isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? "free" : priceCat === "value" ? "ticketed" : "unknown",
      isFree,
      registrationRequired: /inscri[çc][ãa]o|reserva obrigat/i.test(notes.join(" ")),
      online: false,
      familyFriendly: group === "family" || /infantil|fam[íi]lia|crian[çc]as/i.test(`${r.subject ?? ""} ${tags.join(" ")}`),
      officialUrl: r.link,
      imageUrl: r.featured_media_large || undefined,
      posterHue: hueOf(String(r.id)),
      participants: [],
      provenance: { provider: "lisbon", externalId: String(r.id), sourceUrl: r.link, lastSyncedAt: syncedAt, isDemo: false },
    });
    if (r.link) {
      const min = amounts.length && !isFree ? Math.min(...amounts) : undefined;
      const max = amounts.length > 1 && !isFree ? Math.max(...amounts) : undefined;
      offers.push({
        id: `${id}-agenda`,
        eventId: id,
        provider: "Agenda Cultural de Lisboa",
        providerType: "organizer",
        ticketCategory: "standard",
        label: isFree ? "Free entry, details and booking info" : min !== undefined ? "Advertised price, booking info on the agenda" : "Prices and booking info on the agenda",
        basePrice: min,
        maxPrice: max !== undefined && min !== undefined && max > min ? max : undefined,
        currency: min !== undefined ? "EUR" : "",
        availability: "unknown",
        purchaseUrl: r.link,
        priceObservedAt: min !== undefined ? syncedAt : undefined,
        isDemo: false,
      });
    }
  }
  return { events, venues: [...venues.values()], participants: [], offers, unplaced };
}

// ------------------------------------------------------------------ venue lookup for new venues

const GENERIC = new Set("galeria gallery arte art artes museu museum contemporanea contemporaneo teatro igreja espaco casa centro cultural fundacao biblioteca nacional senhora nossa palacio rua jardim cinema auditorio sala clube associacao municipal studios studio space club hotel rooftop".split(" "));
const STOP = new Set("de da do das dos e a o the of lisboa lisbon lissabon um em cada bairro".split(" "));
const tokens = (s: string) => norm(s).match(/[a-z0-9]+/g)?.filter((t) => t.length > 1 && !STOP.has(t)) ?? [];

/** True when an OpenStreetMap name clearly refers to the same place as the agenda's venue name. */
export function sameVenueName(venue: string, candidate: string): boolean {
  const a = new Set(tokens(venue));
  const b = new Set(tokens(candidate));
  const da = [...a].filter((t) => !GENERIC.has(t));
  const db = [...b].filter((t) => !GENERIC.has(t));
  if (!da.length || !db.length) return a.size > 0 && a.size === b.size && [...a].every((t) => b.has(t));
  const inter = da.filter((t) => db.includes(t)).length;
  return inter >= 1 && inter / da.length >= 0.6 && inter / db.length >= 0.5;
}

async function locateVenue(name: string, ctx: SyncContext): Promise<VenueLocation | null> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", `${name}, Lisboa`);
  url.searchParams.set("lat", String(LISBON.lat));
  url.searchParams.set("lon", String(LISBON.lng));
  url.searchParams.set("limit", "5");
  try {
    // Cached for 30 days: venues don't move.
    const json = (await fetchJson("lisbon", url, ctx, { revalidate: 30 * 86400, attempts: 1, timeoutMs: 5000, headers: { "User-Agent": UA } })) as { features?: { geometry: { coordinates: [number, number] }; properties: { name?: string } }[] };
    for (const f of json.features ?? []) {
      const [lng, lat] = f.geometry.coordinates;
      if (haversineKm(lat, lng, LISBON.lat, LISBON.lng) < 30 && f.properties.name && sameVenueName(name, f.properties.name)) return { name, lat, lng };
    }
  } catch (err) {
    ctx.log("lisbon venue lookup failed", { name, err: String(err) });
  }
  return null;
}

export const lisbonProvider: ProviderAdapter = {
  id: "lisbon",
  name: "Agenda Cultural de Lisboa (City of Lisbon open data)",
  isDemo: false,
  coverage: "Concerts, theatre, exhibitions, cinema, talks and guided visits listed by the City of Lisbon's cultural agenda.",
  attribution: "Source: Agenda Cultural de Lisboa, Câmara Municipal de Lisboa (agendalx.pt), CC BY 4.0.",
  isConfigured: () => true,
  refreshIntervalMs: 3 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const raw: AlxEvent[] = [];
    let failures = 0;
    let lastError = "";
    for (let page = 1; page <= 40 && raw.length < ctx.maxEvents; page++) {
      const url = new URL(BASE);
      url.searchParams.set("per_page", "50");
      url.searchParams.set("page", String(page));
      try {
        const list = (await fetchJson("lisbon", url, ctx, { headers: { "User-Agent": UA } })) as AlxEvent[] | unknown;
        if (!Array.isArray(list) || !list.length) break;
        raw.push(...list);
        if (list.length < 50) break;
      } catch (err) {
        failures++;
            lastError = String(err).slice(0, 160);
        ctx.log("lisbon page failed", { page, err: String(err) });
        if (failures >= 3) break;
      }
      await sleep(150);
    }
    let fromSnapshot = false;
    if (!raw.length) {
      const snap = SNAPSHOT as unknown as { fetchedAt: string; events: AlxEvent[] };
      raw.push(...snap.events);
      fromSnapshot = true;
      ctx.log("lisbon live API unavailable, using snapshot", { fetchedAt: snap.fetchedAt, lastError });
      lastError = `live API refused (${lastError}); showing the snapshot from ${snap.fetchedAt.slice(0, 16).replace("T", " ")} UTC`;
    }
    // Look up venues that are not in the bundled table (a few per run, gently paced).
    const located: Record<string, VenueLocation> = { ...known };
    const unknown = new Map<string, string>();
    for (const r of raw) {
      const v = r.venue && !Array.isArray(r.venue) ? Object.entries(r.venue)[0] : undefined;
      if (v && !located[v[0]] && v[1].name) unknown.set(v[0], decode(v[1].name));
    }
    // Capped so a cold server is ready quickly; lookups are cached for 30 days, so later
    // runs work through the rest.
    for (const [slug, name] of [...unknown].slice(0, 12)) {
      const loc = await locateVenue(name, ctx);
      if (loc) located[slug] = loc;
      await sleep(250);
    }
    const { unplaced, ...batch } = normalizeLisbon(raw, syncedAt, located);
    if (unplaced) ctx.log("lisbon events without a mappable venue", { unplaced });
    return {
      batch,
      run: { imported: batch.events.length, updated: 0, failures, rateLimited: false, ok: batch.events.length > 0 || failures === 0, finishedAt: new Date().toISOString(), error: fromSnapshot ? lastError : failures ? `${failures} page request(s) failed (last: ${lastError})` : undefined },
    };
  },
};
