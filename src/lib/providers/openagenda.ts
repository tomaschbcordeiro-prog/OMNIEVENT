import tzlookup from "@photostructure/tz-lookup";
import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, nearestCityId, parseAmount, plainText } from "./common";

/**
 * OpenAgenda's public events, the open-data export on public.opendatasoft.com
 * ("evenements-publics-openagenda"): agendas published by French towns, departments,
 * libraries, museums, theatres and festivals, down to small villages, with each venue's
 * coordinates. No key needed.
 *
 * The export is read in windows of start date (one request each): weekly for the coming
 * year, then four-weekly up to five years ahead, plus one window for events that began
 * earlier and are still running.
 */

const API = "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/evenements-publics-openagenda/exports/json";
const FIELDS = [
  "uid", "slug", "canonicalurl", "title_fr", "description_fr", "keywords_fr", "conditions_fr", "image",
  "firstdate_begin", "firstdate_end", "lastdate_begin", "lastdate_end", "location_coordinates", "location_name",
  "location_address", "location_city", "location_postalcode", "location_countrycode", "attendancemode", "status",
  "age_min", "age_max", "originagenda_title", "registration",
];

export interface OaRow {
  uid: number | string;
  slug?: string;
  canonicalurl?: string;
  title_fr?: string | null;
  description_fr?: string | null;
  keywords_fr?: string[] | string | null;
  conditions_fr?: string | null;
  image?: string | null;
  firstdate_begin?: string | null;
  firstdate_end?: string | null;
  lastdate_begin?: string | null;
  lastdate_end?: string | null;
  location_coordinates?: { lat?: number; lon?: number } | null;
  location_name?: string | null;
  location_address?: string | null;
  location_city?: string | null;
  location_postalcode?: string | null;
  location_countrycode?: string | null;
  attendancemode?: string | { id?: number } | null;
  status?: string | { id?: number } | null;
  age_min?: number | null;
  age_max?: number | null;
  originagenda_title?: string | null;
}

const COUNTRY: Record<string, string> = { FR: "France", BE: "Belgium", CH: "Switzerland", LU: "Luxembourg", IT: "Italy", ES: "Spain", DE: "Germany", CA: "Canada", MA: "Morocco", MC: "Monaco", RE: "France", GP: "France", MQ: "France", GF: "France", YT: "France", NC: "France", PF: "France" };

// Checked in order on the title and keywords; the first match decides.
const KEYWORDS: [RegExp, string][] = [
  [/jeune public|enfant|famille|conte|marionnette|kids/, "family-shows"],
  [/op[ée]ra/, "opera"],
  [/jazz/, "jazz"],
  [/orchestre|symphon|classique|r[ée]cital|musique de chambre|chorale|choeur/, "classical"],
  [/festival/, "festivals"],
  [/concert|musique|chanson|rock|rap\b|[ée]lectro/, "concerts"],
  [/danse|ballet/, "dance"],
  [/cirque/, "circus"],
  [/humour|stand.?up|one.?man/, "stand-up"],
  [/th[ée][âa]tre|spectacle|com[ée]die/, "plays"],
  [/cin[ée]ma|projection|film/, "cinema"],
  [/exposition|expo\b|vernissage|mus[ée]e|galerie/, "art-exhibitions"],
  [/conf[ée]rence|rencontre|d[ée]bat|lecture|dédicace|d[ée]dicace/, "public-lectures"],
  [/atelier|stage|initiation|cours/, "creative-workshops"],
  [/visite|balade|randonn[ée]e|patrimoine|journ[ée]es europ/, "guided-tours"],
  [/march[ée]|brocante|vide.?grenier|foire|f[êe]te/, "street-festivals"],
  [/d[ée]gustation|vin|gastronom/, "tastings"],
  [/course|trail|marathon|sport|match|tournoi/, "sports"],
];

export function mapOaCategory(title: string, keywords: string[]): string {
  const t = `${title} ${keywords.join(" ")}`.toLowerCase();
  for (const [re, slug] of KEYWORDS) if (re.test(t)) return slug;
  return "culture";
}

const idOf = (v: OaRow["attendancemode"] | OaRow["status"]): number | undefined => {
  if (v == null) return undefined;
  if (typeof v === "object") return v.id;
  try {
    return (JSON.parse(v) as { id?: number }).id;
  } catch {
    return undefined;
  }
};

/** Pure mapping function — unit-tested in tests/openagenda.test.ts. */
export function normalizeOpenAgenda(rows: OaRow[], syncedAt: string, now = Date.now()): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const uid = String(r.uid);
    if (seen.has(uid)) continue;
    seen.add(uid);
    const lat = Number(r.location_coordinates?.lat);
    const lng = Number(r.location_coordinates?.lon);
    const title = plainText(r.title_fr ?? undefined);
    if (!title || !r.canonicalurl || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    // 2 = online only; status 6 = cancelled (OpenAgenda's ids).
    if (idOf(r.attendancemode) === 2 || idOf(r.status) === 6) continue;
    const start = Date.parse(r.firstdate_begin ?? "");
    const lastEnd = Date.parse(r.lastdate_end ?? r.firstdate_end ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(lastEnd) || lastEnd < now) continue;
    // Catalogue agendas list performers' shows with placeholder dates, not real dates.
    if (/catalogue/i.test(r.originagenda_title ?? "")) continue;
    if (start > now + 5 * 366 * 86400000) continue;

    let tz = "Europe/Paris";
    try {
      tz = tzlookup(lat, lng);
    } catch {
      // keep Paris
    }
    const cc = (r.location_countrycode ?? "FR").toUpperCase();
    const city = r.location_city?.trim() || r.location_address?.split(",").pop()?.trim() || "";
    const name = r.location_name?.trim() || city || "Venue";
    const venueKey = `${name}|${lat.toFixed(4)},${lng.toFixed(4)}`;
    const venueId = `oa-v-${hueOf(venueKey)}-${slugify(name).slice(0, 40)}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${name}-${city}-${hueOf(venueKey)}`),
        name,
        address: r.location_address?.trim() || undefined,
        city,
        cityId: nearestCityId(lat, lng),
        country: COUNTRY[cc] ?? cc,
        countryCode: COUNTRY[cc] === "France" ? "FR" : cc,
        lat,
        lng,
        timeZone: tz,
        provenance: { provider: "openagenda", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });

    const keywords = Array.isArray(r.keywords_fr) ? r.keywords_fr : typeof r.keywords_fr === "string" ? r.keywords_fr.split(/[;,]/) : [];
    const cat = mapOaCategory(title, keywords);
    const firstEnd = Date.parse(r.firstdate_end ?? "");
    // Several sessions or a run over days: shown from the first session to the last.
    const multi = lastEnd - start > 24 * 3600000;
    const conditions = plainText(r.conditions_fr ?? undefined) ?? "";
    const isFree = /gratuit|entr[ée]e libre|libre et gratuit|free/i.test(conditions);
    const price = isFree ? undefined : parseAmount(conditions);
    const id = `oa-e-${uid}`;
    const allDay = /T(22|23):00:00\+00:00$/.test(r.firstdate_begin ?? "") && Number.isFinite(firstEnd) && firstEnd - start >= 23 * 3600000;
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${title}-${city}-${uid.slice(-6)}`),
      title,
      description: [plainText(r.description_fr ?? undefined), conditions && `Conditions: ${conditions}`].filter(Boolean).join("\n\n").slice(0, 1500) || undefined,
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: multi ? "multi_day" : "single",
      venueId,
      start: new Date(start).toISOString(),
      end: multi ? new Date(lastEnd).toISOString() : Number.isFinite(firstEnd) && firstEnd > start ? new Date(firstEnd).toISOString() : undefined,
      hoursUnknown: allDay || undefined,
      timeZone: tz,
      status: isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? "free" : price !== undefined ? "ticketed" : "unknown",
      isFree,
      registrationRequired: /inscription|r[ée]servation obligatoire/i.test(conditions),
      online: false,
      familyFriendly: cat === "family-shows" || (r.age_min != null && r.age_min <= 6),
      ageRestriction: r.age_min && r.age_min >= 12 ? { minAge: r.age_min, note: `From ${r.age_min} years.` } : undefined,
      officialUrl: r.canonicalurl,
      imageUrl: r.image ?? undefined,
      posterHue: hueOf(uid),
      participants: [],
      provenance: { provider: "openagenda", externalId: uid, sourceUrl: r.canonicalurl, lastSyncedAt: syncedAt, isDemo: false },
    });
    if (price !== undefined)
      offers.push({
        id: `${id}-price`,
        eventId: id,
        provider: r.originagenda_title?.trim() || name,
        providerType: "box_office",
        ticketCategory: "standard",
        label: `Advertised: ${conditions.slice(0, 80)}`,
        basePrice: price,
        currency: "EUR",
        availability: "unknown",
        purchaseUrl: r.canonicalurl,
        priceObservedAt: syncedAt,
        isDemo: false,
      });
  }
  return { events, venues: [...venues.values()], participants: [], offers };
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export const openAgendaProvider: ProviderAdapter = {
  id: "openagenda",
  name: "OpenAgenda (France and neighbours)",
  isDemo: false,
  coverage: "Public events published on OpenAgenda by French towns, departments, libraries, museums, theatres and festivals, including small villages.",
  attribution: "Data: OpenAgenda public events (open licence), via Opendatasoft.",
  isConfigured: () => true,
  refreshIntervalMs: 6 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const day = 86400000;
    const today = Math.floor(Date.now() / day) * day;
    const weeks = Number(process.env.OPENAGENDA_WEEKS ?? 52);
    const windows: string[] = [`firstdate_begin < "${iso(today)}" AND lastdate_end >= "${iso(today)}"`];
    const horizon = Number(process.env.OPENAGENDA_HORIZON_WEEKS ?? 261);
    const range = (a: number, b: number) => `firstdate_begin >= "${iso(today + a * 7 * day)}" AND firstdate_begin < "${iso(today + b * 7 * day)}"`;
    for (let w = 0; w < weeks; w++) windows.push(range(w, w + 1));
    for (let w = weeks; w < horizon; w += 4) windows.push(range(w, Math.min(horizon, w + 4)));
    const rows: OaRow[] = [];
    let failures = 0;
    let lastError = "";
    const queue = [...windows];
    const worker = async () => {
      while (queue.length) {
        const where = queue.shift()!;
        const url = new URL(API);
        url.searchParams.set("select", FIELDS.join(","));
        url.searchParams.set("where", where);
        try {
          rows.push(...((await fetchJson("openagenda", url, ctx, { revalidate: 0, timeoutMs: 90000, attempts: 3 })) as OaRow[]));
          ctx.onProgress?.(normalizeOpenAgenda(rows, syncedAt));
        } catch (err) {
          failures++;
          lastError = String(err).slice(0, 160);
          ctx.log("openagenda window failed", { where, err: lastError });
        }
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));
    const batch = normalizeOpenAgenda(rows, syncedAt);
    return {
      batch,
      run: { imported: batch.events.length, updated: 0, failures, rateLimited: false, ok: batch.events.length > 0, finishedAt: new Date().toISOString(), error: failures ? `${failures} of ${windows.length} date windows failed (last: ${lastError})` : undefined },
    };
  },
};
