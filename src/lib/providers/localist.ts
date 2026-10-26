import tzlookup from "@photostructure/tz-lookup";
import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, nearestCityId, parseAmount, plainText } from "./common";
import { getState, setState } from "../shared-cache";
import HOSTS from "./data/localist-hosts.json";

/**
 * Public event calendars run on Localist (universities, colleges, cities), read through
 * Localist's public API (/api/2/events), no key needed. Concerts, talks, exhibitions,
 * theatre, sports, tours and community events, each with its venue's coordinates.
 *
 * - The calendars are listed in data/localist-hosts.json (found by scripts/find-localist.mjs).
 * - Events without venue coordinates are left out (some calendars publish none).
 * - There are many, so runs are cut after a few minutes and the next run continues from the
 *   saved queue; once all are read, the round starts again twelve hours later.
 * - Online-only, private and internal entries (deadlines, office hours, meetings, events
 *   only for students or staff) are left out.
 */

const DAYS = 365;
const PER_PAGE = 100;

export interface LocalistEvent {
  id: number;
  title?: string;
  url?: string | null;
  status?: string;
  experience?: string;
  private?: boolean;
  free?: boolean;
  ticket_url?: string | null;
  ticket_cost?: string | null;
  location_name?: string | null;
  address?: string | null;
  venue_id?: number | null;
  description_text?: string | null;
  photo_url?: string | null;
  localist_url?: string;
  first_date?: string;
  last_date?: string;
  geo?: { latitude?: string | null; longitude?: string | null; city?: string | null; state?: string | null; country?: string | null; street?: string | null; zip?: string | null } | null;
  filters?: Record<string, { name: string }[] | undefined>;
  event_instances?: { event_instance: { id: number; start: string; end?: string | null; all_day?: boolean } }[];
}

export interface LocalistHost {
  host: string;
  name: string;
}

const MAP: [RegExp, string][] = [
  [/opera/, "opera"], [/jazz/, "jazz"], [/orchestra|symphony|chamber|classical|recital/, "classical"], [/concert|music|choir|band\b/, "concerts"],
  [/dance/, "dance"], [/theat|play\b|drama|musical/, "plays"], [/comedy|improv/, "stand-up"], [/film|cinema|screening|movie/, "cinema"],
  [/exhibit|gallery|museum|art show/, "art-exhibitions"], [/athletic|sport|game\b|basketball|football|soccer|hockey|baseball|volleyball|tennis|swim|track|lacrosse|softball|wrestling|golf/, "sports"],
  [/tour|walk|garden|hike/, "guided-tours"], [/festival/, "festivals"], [/fair|market/, "street-festivals"], [/workshop|class\b|craft/, "creative-workshops"],
  [/kids|children|famil/, "family-shows"], [/science|planetarium|observatory|astronomy/, "science-exhibitions"],
  [/lecture|talk|seminar|colloquium|symposium|panel|conference|reading|author|discussion|forum/, "public-lectures"],
];

export function mapLocalistCategory(text: string): string {
  const t = text.toLowerCase();
  for (const [re, slug] of MAP) if (re.test(t)) return slug;
  return "culture";
}

const INTERNAL = /\btabling\b|testing (our|the) (new )?calendar|test event|deadline|office hours?|registration (opens|closes)|add\/drop|last day to|no classes|classes (begin|end)|exam|commencement rehearsal|staff meeting|faculty meeting|board meeting|committee|senate|orientation|advising|info(rmation)? session|webinar|zoom|virtual|blood drive|payroll|training\b/i;
const PUBLIC_AUDIENCE = /public|everyone|community|all\b|open to|visitor|alumni|famil|kids|children|prospective|guests?/i;

const names = (list?: { name: string }[]) => (list ?? []).map((x) => x.name).filter(Boolean);

/** Pure mapping function — unit-tested in tests/localist.test.ts. */
export function normalizeLocalist(rows: LocalistEvent[], host: LocalistHost, syncedAt: string, now = Date.now()): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];
  // The API lists one entry per occurrence; occurrences of an event are joined.
  const byId = new Map<number, { e: LocalistEvent; sessions: { start: number; end?: number; allDay: boolean }[] }>();
  for (const e of rows) {
    if (!e?.id || !e.title) continue;
    const g = byId.get(e.id) ?? { e, sessions: [] };
    for (const { event_instance: i } of e.event_instances ?? []) {
      const start = Date.parse(i.start);
      if (!Number.isFinite(start) || g.sessions.some((s) => s.start === start)) continue;
      const endRaw = i.end ? Date.parse(i.end) : NaN;
      g.sessions.push({ start, end: Number.isFinite(endRaw) && endRaw > start ? endRaw : undefined, allDay: !!i.all_day });
    }
    byId.set(e.id, g);
  }
  const short = host.host.replace(/^(events|calendar)\./, "").replace(/\.(edu|org|com|gov|ca|ac\.uk|edu\.au)$/, "");
  for (const { e, sessions } of byId.values()) {
    const title = plainText(e.title);
    const lat = Number(e.geo?.latitude);
    const lng = Number(e.geo?.longitude);
    if (!title || e.private || (e.status && e.status !== "live") || e.experience === "virtual") continue;
    if (!e.geo?.latitude || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    const types = names(e.filters?.event_types);
    const audience = names(e.filters?.event_audience);
    if (INTERNAL.test(`${title} ${types.join(" ")}`)) continue;
    if (audience.length && !audience.some((a) => PUBLIC_AUDIENCE.test(a))) continue;
    const future = sessions.filter((s) => (s.end ?? s.start + (s.allDay ? 86400000 : 3600000)) >= now).sort((a, b) => a.start - b.start);
    if (!future.length) continue;

    let tz = "UTC";
    try {
      tz = tzlookup(lat, lng);
    } catch {
      // keep UTC
    }
    const cc = (e.geo?.country || "US").toUpperCase().slice(0, 2);
    const placeName = e.location_name?.trim() || e.geo?.street?.trim() || host.name;
    const venueKey = `${host.host}|${e.venue_id ?? placeName}|${lat.toFixed(4)},${lng.toFixed(4)}`;
    const venueId = `loc-v-${hueOf(venueKey)}-${slugify(placeName).slice(0, 40) || "venue"}`;
    const city = e.geo?.city?.trim() || "";
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${placeName}-${city}-${hueOf(venueKey)}`),
        name: placeName,
        address: e.address?.trim() || [e.geo?.street, e.geo?.city, e.geo?.state, e.geo?.zip].filter(Boolean).join(", ") || undefined,
        city,
        cityId: nearestCityId(lat, lng),
        country: cc === "US" ? "United States" : cc === "CA" ? "Canada" : cc === "GB" ? "United Kingdom" : cc === "AU" ? "Australia" : cc,
        countryCode: cc,
        lat,
        lng,
        timeZone: tz,
        provenance: { provider: "localist", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });

    const cat = mapLocalistCategory(`${types.join(" ")} ${names(e.filters?.event_subject).join(" ")} ${title}`);
    const s0 = future[0];
    const multi = s0.end !== undefined && s0.end - s0.start > 36 * 3600000;
    const costText = e.ticket_cost?.trim() ?? "";
    const isFree = !!e.free || /^free\b/i.test(costText);
    const price = isFree ? undefined : parseAmount(costText);
    const id = `loc-e-${slugify(short).slice(0, 20)}-${e.id}`;
    const url = e.localist_url || `https://${host.host}`;
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${title}-${short}-${String(e.id).slice(-6)}`),
      title,
      description: [host.name, plainText(e.description_text)].filter(Boolean).join(". ").slice(0, 1500),
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: multi ? "multi_day" : future.length > 1 ? "recurring" : "single",
      venueId,
      start: new Date(s0.start).toISOString(),
      end: s0.end !== undefined && (multi || future.length === 1) ? new Date(s0.end).toISOString() : undefined,
      schedule: !multi && future.length > 1 ? future.slice(1, 200).map((s) => new Date(s.start).toISOString()) : undefined,
      hoursUnknown: s0.allDay || undefined,
      timeZone: tz,
      status: isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? "free" : e.ticket_url || price !== undefined ? "ticketed" : "unknown",
      isFree,
      registrationRequired: false,
      online: false,
      familyFriendly: cat === "family-shows" || audience.some((a) => /famil|kids|children/i.test(a)),
      officialUrl: url,
      imageUrl: e.photo_url || undefined,
      posterHue: hueOf(id),
      participants: [],
      provenance: { provider: "localist", externalId: `${host.host}:${e.id}`, sourceUrl: url, lastSyncedAt: syncedAt, isDemo: false },
    });
    if (!isFree && (e.ticket_url || price !== undefined))
      offers.push({
        id: `${id}-tickets`,
        eventId: id,
        provider: (() => {
          try {
            return new URL(e.ticket_url!).hostname.replace(/^www\./, "");
          } catch {
            return host.name;
          }
        })(),
        providerType: "primary",
        ticketCategory: "standard",
        label: costText ? `Advertised: ${costText.slice(0, 80)}` : "Tickets",
        basePrice: price,
        currency: price !== undefined ? (cc === "CA" ? "CAD" : cc === "GB" ? "GBP" : cc === "AU" ? "AUD" : "USD") : "",
        availability: "unknown",
        purchaseUrl: e.ticket_url || url,
        priceObservedAt: price !== undefined ? syncedAt : undefined,
        isDemo: false,
      });
  }
  return { events, venues: [...venues.values()], participants: [], offers };
}

function joinBatches(list: ProviderBatch[]): ProviderBatch {
  return { events: list.flatMap((b) => b.events), venues: list.flatMap((b) => b.venues), participants: [], offers: list.flatMap((b) => b.offers) };
}

export const localistProvider: ProviderAdapter = {
  id: "localist",
  name: "Localist calendars (universities and cities)",
  isDemo: false,
  coverage: "Public events of universities, colleges and cities whose calendars run on Localist: concerts, talks, exhibitions, theatre, sports and tours.",
  attribution: "Data: each institution's public Localist calendar.",
  isConfigured: () => true,
  // Runs every half hour until every calendar is read, then again after twelve hours.
  refreshIntervalMs: 30 * 60000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const hosts = HOSTS as LocalistHost[];
    const all = hosts.map((h) => h.host);
    const saved = await getState<{ queue: string[] }>("localist:crawl");
    const resume = saved?.queue?.length ? saved.queue.filter((h) => all.includes(h)) : undefined;
    const done = await getState<number>("localist:complete");
    if (!resume && done && Date.now() - done < 12 * 3600000)
      return { batch: { events: [], venues: [], participants: [], offers: [] }, run: { imported: 0, updated: 0, failures: 0, rateLimited: false, ok: true, partial: true, finishedAt: new Date().toISOString() } };
    const queue = [...(resume ?? all)];
    const deadline = Date.now() + Number(process.env.LOCALIST_RUN_SECONDS ?? 220) * 1000;
    const results: ProviderBatch[] = [];
    const left: string[] = [];
    let failures = 0;
    let lastError = "";
    const worker = async () => {
      while (queue.length && Date.now() < deadline) {
        const name = queue.shift()!;
        const host = hosts.find((h) => h.host === name)!;
        const rows: LocalistEvent[] = [];
        try {
          for (let page = 1; page <= 60; page++) {
            if (Date.now() > deadline) throw new Error("run time used up");
            const json = (await fetchJson("localist", `https://${name}/api/2/events?days=${DAYS}&pp=${PER_PAGE}&page=${page}`, ctx, { revalidate: 0, timeoutMs: 30000 })) as { events?: { event: LocalistEvent }[]; page?: { total?: number } };
            rows.push(...(json.events ?? []).map((x) => x.event));
            if (page >= (json.page?.total ?? 0)) break;
            // Calendars that don't publish venue coordinates can't be shown; stop early.
            if (page === 1 && !rows.some((r) => r.geo?.latitude)) break;
          }
          results.push(normalizeLocalist(rows, host, syncedAt));
          if (results.length % 5 === 0) ctx.onProgress?.(joinBatches(results));
        } catch (err) {
          if (/run time used up/.test(String(err))) left.push(name);
          else {
            failures++;
            lastError = `${name}: ${String(err).slice(0, 120)}`;
            ctx.log("localist calendar failed", { host: name, err: lastError });
          }
        }
      }
    };
    await Promise.all(Array.from({ length: 10 }, worker));
    const remaining = [...left, ...queue];
    await setState("localist:crawl", remaining.length ? { queue: remaining } : undefined, 7 * 86400);
    if (!remaining.length) await setState("localist:complete", Date.now());
    const batch = joinBatches(results);
    return {
      batch,
      run: {
        imported: batch.events.length,
        updated: 0,
        failures,
        rateLimited: false,
        ok: batch.events.length > 0 || failures === 0,
        partial: true,
        finishedAt: new Date().toISOString(),
        error: remaining.length ? `${remaining.length} of ${all.length} calendars left; the next run continues from there` : lastError || undefined,
      },
    };
  },
};
