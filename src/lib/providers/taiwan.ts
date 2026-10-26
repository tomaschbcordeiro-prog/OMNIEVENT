import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, keyOf, nearestCityId, parseAmount, parseLocal, plainText } from "./common";

/**
 * Taiwan Ministry of Culture open data (cloud.culture.tw): concerts, theatre, dance,
 * exhibitions, talks and films across Taiwan, each session with its venue's coordinates.
 * No key needed. A programme touring several venues becomes one event per venue.
 */

const API = "https://cloud.culture.tw/frontsite/trans/SearchShowAction.do?method=doFindTypeJ&category=all";
const TZ = "Asia/Taipei";

export interface TwShow {
  time?: string;
  endTime?: string;
  location?: string;
  locationName?: string;
  onSales?: string;
  price?: string;
  latitude?: string | null;
  longitude?: string | null;
}

export interface TwEvent {
  UID: string;
  title?: string;
  category?: string;
  showInfo?: TwShow[];
  showUnit?: string;
  descriptionFilterHtml?: string;
  imageUrl?: string;
  webSales?: string;
  sourceWebPromote?: string;
  startDate?: string;
  endDate?: string;
}

const CATEGORY: Record<string, string> = {
  "1": "concerts", "2": "plays", "3": "dance", "4": "family-shows", "5": "indie", "6": "art-exhibitions", "7": "public-lectures",
  "8": "cinema", "11": "culture", "13": "culture", "14": "culture", "15": "culture", "17": "concerts", "19": "creative-workshops",
};

const local = (s?: string) => (s ? s.replace(/\//g, "-") : undefined);

/** Pure mapping function — unit-tested in tests/taiwan.test.ts. */
export function normalizeTaiwan(rows: TwEvent[], syncedAt: string, now = Date.now()): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];
  for (const e of rows) {
    if (!e.UID || !e.title) continue;
    // Sessions grouped by venue.
    const byVenue = new Map<string, { show: TwShow; start: number; end?: number }[]>();
    for (const s of e.showInfo ?? []) {
      const lat = Number(s.latitude);
      const lng = Number(s.longitude);
      // Taiwan and its outlying islands.
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 21.8 || lat > 26.5 || lng < 118 || lng > 122.2) continue;
      const start = parseLocal(local(s.time), TZ);
      if (start === undefined) continue;
      const endRaw = parseLocal(local(s.endTime), TZ);
      const end = endRaw !== undefined && endRaw > start ? endRaw : undefined;
      if ((end ?? start) < now) continue;
      const key = `${s.locationName ?? s.location}|${lat.toFixed(4)},${lng.toFixed(4)}`;
      byVenue.set(key, [...(byVenue.get(key) ?? []), { show: s, start, end }]);
    }
    for (const [venueKey, sessions] of byVenue) {
      sessions.sort((a, b) => a.start - b.start);
      const first = sessions[0];
      const s = first.show;
      const lat = Number(s.latitude);
      const lng = Number(s.longitude);
      const city = s.location?.match(/^(.{2,3}[市縣])/)?.[1] ?? "";
      const name = s.locationName?.trim() || s.location?.trim() || "Venue";
      const venueId = `tw-v-${keyOf(venueKey)}-${slugify(name).slice(0, 30) || "venue"}`;
      if (!venues.has(venueId))
        venues.set(venueId, {
          id: venueId,
          slug: slugify(`${name}-${keyOf(venueKey)}`) || `venue-${keyOf(venueKey)}`,
          name,
          address: s.location?.trim() || undefined,
          city,
          cityId: nearestCityId(lat, lng),
          country: "Taiwan",
          countryCode: "TW",
          lat,
          lng,
          timeZone: TZ,
          provenance: { provider: "taiwan", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
        });
      const cat = CATEGORY[e.category ?? ""] ?? "culture";
      const multi = first.end !== undefined && first.end - first.start > 36 * 3600000;
      const id = `tw-e-${e.UID}-${keyOf(venueKey)}`;
      const priceText = s.price?.trim() ?? "";
      const isFree = /免費|免票|free/i.test(priceText);
      const price = isFree ? undefined : parseAmount(priceText);
      const link = e.sourceWebPromote || e.webSales || undefined;
      events.push({
        id,
        canonicalId: id,
        slug: `${slugify(e.title).slice(0, 60) || "event"}-tw-${keyOf(id)}`,
        title: e.title.trim(),
        description: [e.showUnit, plainText(e.descriptionFilterHtml)].filter(Boolean).join(". ").slice(0, 1500) || undefined,
        categorySlug: cat,
        groupSlug: groupOf(cat),
        eventType: multi ? "multi_day" : sessions.length > 1 ? "recurring" : "single",
        venueId,
        start: new Date(first.start).toISOString(),
        end: first.end !== undefined && (multi || sessions.length === 1) ? new Date(first.end).toISOString() : undefined,
        schedule: !multi && sessions.length > 1 ? sessions.slice(1, 200).map((x) => new Date(x.start).toISOString()) : undefined,
        timeZone: TZ,
        status: isFree ? "free_entry" : "scheduled",
        ticketAccess: isFree ? "free" : price !== undefined || e.webSales ? "ticketed" : "unknown",
        isFree,
        registrationRequired: false,
        online: false,
        familyFriendly: cat === "family-shows",
        officialUrl: link,
        imageUrl: e.imageUrl || undefined,
        posterHue: hueOf(e.UID),
        participants: [],
        provenance: { provider: "taiwan", externalId: e.UID, sourceUrl: link, lastSyncedAt: syncedAt, isDemo: false },
      });
      if (price !== undefined || e.webSales)
        offers.push({
          id: `${id}-tickets`,
          eventId: id,
          provider: e.webSales ? (() => { try { return new URL(e.webSales!).hostname.replace(/^www\./, ""); } catch { return name; } })() : name,
          providerType: "primary",
          ticketCategory: "standard",
          label: priceText ? `Advertised: ${priceText.slice(0, 80)}` : "Tickets",
          basePrice: price,
          currency: price !== undefined ? "TWD" : "",
          availability: s.onSales === "Y" ? "available" : "unknown",
          purchaseUrl: e.webSales || link || "https://cloud.culture.tw",
          priceObservedAt: price !== undefined ? syncedAt : undefined,
          isDemo: false,
        });
    }
  }
  return { events, venues: [...venues.values()], participants: [], offers };
}

export const taiwanProvider: ProviderAdapter = {
  id: "taiwan",
  name: "Taiwan Ministry of Culture",
  isDemo: false,
  coverage: "Concerts, theatre, dance, exhibitions, talks and films across Taiwan.",
  attribution: "Data: Ministry of Culture, Taiwan (open government data).",
  isConfigured: () => true,
  refreshIntervalMs: 6 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const rows = (await fetchJson("taiwan", API, ctx, { revalidate: 0, timeoutMs: 90000 })) as TwEvent[];
    const batch = normalizeTaiwan(rows, syncedAt);
    return { batch, run: { imported: batch.events.length, updated: 0, failures: 0, rateLimited: false, ok: true, finishedAt: new Date().toISOString() } };
  },
};
