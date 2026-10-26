import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, keyOf, nearestCityId, parseAmount, plainText } from "./common";
import { getState, setState } from "../shared-cache";
import { INTERNAL, PUBLIC_AUDIENCE, mapLocalistCategory } from "./localist";
import HOSTS from "./data/livewhale-hosts.json";

/**
 * Public event calendars run on LiveWhale (universities and colleges in the US, Canada and
 * Australia), read through LiveWhale's public JSON API (/live/json/events), no key needed.
 *
 * - The calendars are listed in data/livewhale-hosts.json (only those that publish venue
 *   positions); events without a position are left out.
 * - The API answers at most 100 events per request, so each calendar is read in date
 *   windows for the coming year. Runs are cut after a few minutes and the next run continues
 *   from the saved queue; once all are read, the round starts again twelve hours later.
 * - Online-only, cancelled and internal entries are left out, as for Localist.
 */

const DAYS = 365;
const FIELDS = "location,location_title,location_latitude,location_longitude,cost,description,event_types,event_types_audience,thumbnail,is_online,online_type,is_canceled,parent,group_title";

export interface LwEvent {
  id: number;
  parent?: number | null;
  title?: string;
  url?: string;
  date_iso?: string;
  date2_iso?: string | null;
  timezone?: string;
  is_all_day?: number | boolean | null;
  is_canceled?: number | boolean | null;
  is_online?: number | boolean | null;
  online_type?: string | null;
  cost?: string | null;
  description?: string | null;
  location?: string | null;
  location_title?: string | null;
  location_latitude?: string | number | null;
  location_longitude?: string | number | null;
  event_types?: string[] | null;
  event_types_audience?: string[] | null;
  thumbnail?: string | null;
  group_title?: string | null;
}

export interface LwHost {
  host: string;
  name: string;
}

function countryOf(host: string): string {
  if (host.endsWith(".ca")) return "CA";
  if (host.endsWith(".au")) return "AU";
  return "US";
}
/** Some calendars return numbers or objects where text is expected. */
const txt = (v: unknown) => (typeof v === "string" ? plainText(v) : undefined);

const COUNTRY: Record<string, string> = { US: "United States", CA: "Canada", AU: "Australia" };
const CURRENCY: Record<string, string> = { US: "USD", CA: "CAD", AU: "AUD" };

/** Pure mapping function — unit-tested in tests/livewhale.test.ts. */
export function normalizeLiveWhale(rows: LwEvent[], host: LwHost, syncedAt: string, now = Date.now()): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];
  // Occurrences of a repeating event share a parent.
  const groups = new Map<number | string, { e: LwEvent; sessions: { start: number; end?: number; allDay: boolean }[] }>();
  for (const e of rows) {
    if (!e?.id || typeof e.title !== "string" || e.is_canceled) continue;
    const start = Date.parse(e.date_iso ?? "");
    if (!Number.isFinite(start)) continue;
    const endRaw = Date.parse(e.date2_iso ?? "");
    // Without a parent, sessions of the same title at the same place are joined.
    const key = e.parent || `${e.title.trim().toLowerCase()}|${e.location_latitude ?? ""},${e.location_longitude ?? ""}`;
    const g = groups.get(key) ?? { e, sessions: [] };
    if (!g.sessions.some((s) => s.start === start)) g.sessions.push({ start, end: Number.isFinite(endRaw) && endRaw > start ? endRaw : undefined, allDay: !!e.is_all_day });
    groups.set(key, g);
  }
  const short = host.host.replace(/^(events|calendar|www)\./, "").replace(/\.(edu|ca|edu\.au)$/, "");
  for (const [key, { e, sessions }] of groups) {
    const title = txt(e.title);
    const lat = Number(e.location_latitude);
    const lng = Number(e.location_longitude);
    if (!title || !e.location_latitude || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    if (e.is_online && /only|online/i.test(e.online_type ?? "online")) continue;
    const types = (Array.isArray(e.event_types) ? e.event_types : []).filter((t) => typeof t === "string").map((t) => t.trim());
    const audience = (Array.isArray(e.event_types_audience) ? e.event_types_audience : []).filter((t) => typeof t === "string").map((t) => t.trim());
    if (INTERNAL.test(`${title} ${types.join(" ")}`)) continue;
    if (audience.length && !audience.some((a) => PUBLIC_AUDIENCE.test(a))) continue;
    const future = sessions.filter((s) => (s.end ?? s.start + (s.allDay ? 86400000 : 3600000)) >= now).sort((a, b) => a.start - b.start);
    if (!future.length) continue;

    const tz = e.timezone || "America/New_York";
    const cc = countryOf(host.host);
    const placeName = txt(e.location_title) || txt(e.location) || host.name;
    const venueKey = `${host.host}|${placeName}|${lat.toFixed(4)},${lng.toFixed(4)}`;
    const venueId = `lw-v-${keyOf(venueKey)}-${slugify(placeName).slice(0, 40) || "venue"}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${placeName}-${short}-${keyOf(venueKey)}`),
        name: placeName,
        address: txt(e.location) && e.location !== e.location_title ? txt(e.location) : undefined,
        city: "",
        cityId: nearestCityId(lat, lng),
        country: COUNTRY[cc],
        countryCode: cc,
        lat,
        lng,
        timeZone: tz,
        provenance: { provider: "livewhale", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });

    const cat = mapLocalistCategory(`${types.join(" ")} ${title}`);
    const s0 = future[0];
    const multi = s0.end !== undefined && s0.end - s0.start > 36 * 3600000;
    const costText = txt(e.cost) ?? "";
    const isFree = /^free\b|^no cost|^\$?0(\.00)?$/i.test(costText) || (!costText && types.some((t) => /free/i.test(t)));
    const price = isFree ? undefined : parseAmount(costText);
    const id = `lw-e-${slugify(short).slice(0, 20)}-${typeof key === "number" ? key : keyOf(key)}`;
    const url = e.url || `https://${host.host}`;
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${title}-${short}-${typeof key === "number" ? String(key).slice(-6) : keyOf(key)}`),
      title,
      description: [txt(e.group_title) ? `${host.name} · ${txt(e.group_title)}` : host.name, txt(e.description)].filter(Boolean).join(". ").slice(0, 1500),
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
      ticketAccess: isFree ? "free" : price !== undefined ? "ticketed" : "unknown",
      isFree,
      registrationRequired: false,
      online: false,
      familyFriendly: cat === "family-shows" || audience.some((a) => /famil|kids|children/i.test(a)),
      officialUrl: url,
      imageUrl: typeof e.thumbnail === "string" && e.thumbnail.startsWith("http") ? e.thumbnail : undefined,
      posterHue: hueOf(id),
      participants: [],
      provenance: { provider: "livewhale", externalId: `${host.host}:${typeof key === "number" ? key : e.id}`, sourceUrl: url, lastSyncedAt: syncedAt, isDemo: false },
    });
    if (price !== undefined)
      offers.push({
        id: `${id}-tickets`,
        eventId: id,
        provider: host.name,
        providerType: "primary",
        ticketCategory: "standard",
        label: `Advertised: ${costText.slice(0, 80)}`,
        basePrice: price,
        currency: CURRENCY[cc],
        availability: "unknown",
        purchaseUrl: url,
        priceObservedAt: syncedAt,
        isDemo: false,
      });
  }
  return { events, venues: [...venues.values()], participants: [], offers };
}

type Task = { host: string; from: string };
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

export const liveWhaleProvider: ProviderAdapter = {
  id: "livewhale",
  name: "LiveWhale calendars (universities and colleges)",
  isDemo: false,
  coverage: "Public events of universities and colleges whose calendars run on LiveWhale: concerts, talks, exhibitions, theatre, sports and tours.",
  attribution: "Data: each institution's public LiveWhale calendar.",
  isConfigured: () => true,
  // Runs every half hour until every calendar is read, then again after twelve hours.
  refreshIntervalMs: 30 * 60000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const hosts = HOSTS as LwHost[];
    const today = day(Date.now());
    const until = day(Date.now() + DAYS * 86400000);
    const saved = await getState<{ queue: Task[] }>("livewhale:crawl");
    const resume = saved?.queue?.length ? saved.queue.filter((t) => hosts.some((h) => h.host === t.host)) : undefined;
    const done = await getState<number>("livewhale:complete");
    if (!resume && done && Date.now() - done < 12 * 3600000)
      return { batch: { events: [], venues: [], participants: [], offers: [] }, run: { imported: 0, updated: 0, failures: 0, rateLimited: false, ok: true, partial: true, finishedAt: new Date().toISOString() } };
    const queue: Task[] = resume ?? hosts.map((h) => ({ host: h.host, from: today }));
    const deadline = Date.now() + Number(process.env.LIVEWHALE_RUN_SECONDS ?? 220) * 1000;
    const results: ProviderBatch[] = [];
    const left: Task[] = [];
    let failures = 0;
    let lastError = "";
    const worker = async () => {
      while (queue.length && Date.now() < deadline) {
        const task = queue.shift()!;
        const host = hosts.find((h) => h.host === task.host)!;
        const rows = new Map<number, LwEvent>();
        let from = task.from;
        try {
          for (let i = 0; i < 400; i++) {
            if (Date.now() > deadline) {
              left.push({ host: task.host, from });
              break;
            }
            const url = `https://${task.host}/live/json/events/start_date/${from}/end_date/${until}/max/100/response_fields/${FIELDS}/`;
            const json = (await fetchJson("livewhale", url, ctx, { revalidate: 0, timeoutMs: 30000 })) as LwEvent[] | { data?: LwEvent[] };
            const list = Array.isArray(json) ? json : (json.data ?? []);
            for (const e of list) rows.set(e.id, e);
            if (list.length < 100) break;
            // Next window starts on the last day returned (already-seen events are skipped by id);
            // a day with more than 100 events moves on to the next day.
            const last = list.at(-1)?.date_iso?.slice(0, 10) ?? from;
            from = last > from ? last : day(Date.parse(`${from}T12:00:00Z`) + 86400000);
            if (from > until) break;
          }
          results.push(normalizeLiveWhale([...rows.values()], host, syncedAt));
          if (results.length % 5 === 0) ctx.onProgress?.({ events: results.flatMap((b) => b.events), venues: results.flatMap((b) => b.venues), participants: [], offers: results.flatMap((b) => b.offers) });
        } catch (err) {
          failures++;
          lastError = `${task.host}: ${String(err).slice(0, 120)}`;
          ctx.log("livewhale calendar failed", { host: task.host, err: lastError });
          try {
            if (rows.size) results.push(normalizeLiveWhale([...rows.values()], host, syncedAt));
          } catch {
            // what was read can't be used
          }
        }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    const remaining = [...left, ...queue];
    await setState("livewhale:crawl", remaining.length ? { queue: remaining } : undefined, 7 * 86400);
    if (!remaining.length) await setState("livewhale:complete", Date.now());
    const batch: ProviderBatch = { events: results.flatMap((b) => b.events), venues: results.flatMap((b) => b.venues), participants: [], offers: results.flatMap((b) => b.offers) };
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
        error: remaining.length ? `${remaining.length} of ${hosts.length} calendars left; the next run continues from there` : lastError || undefined,
      },
    };
  },
};
