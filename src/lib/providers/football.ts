import tzlookup from "@photostructure/tz-lookup";
import { getCountry, slugify } from "../destinations";
import type { OmniEvent, Participant, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { nearestCityId, sleep } from "./common";
import STADIUMS from "./data/stadiums.json";
import SNAPSHOT from "./data/football-fixtures.json";

/**
 * Football fixtures from football-data.org (v4), every scheduled match of the competitions
 * on the free plan (Premier League, Championship, LaLiga, Bundesliga, Serie A, Ligue 1,
 * Eredivisie, Primeira Liga, Brasileirão, Champions League, World Cup, Euros).
 *
 * - FOOTBALL_DATA_KEY (free at https://www.football-data.org/client/register) enables live
 *   updates; without it the bundled snapshot is shown.
 * - Matches are placed at the home club's stadium: `data/stadiums.json`, built by
 *   scripts/build-stadiums.py from each club's venue and address and checked against
 *   OpenStreetMap. Matches at grounds we haven't located, and finals at neutral venues,
 *   are skipped rather than placed at a guessed location.
 * - The API publishes no ticket prices. Each match links to the home club's official site;
 *   event pages add the resale and ticketing sites of that country.
 * - The API sometimes answers a valid key with "token is invalid"; requests are retried,
 *   and a snapshot (`data/football-fixtures.json`) stands in for a competition that fails.
 */

const BASE = "https://api.football-data.org/v4";
export const COMPETITIONS = ["PL", "ELC", "PD", "BL1", "SA", "FL1", "DED", "PPL", "BSA", "CL", "WC", "EC"];

export type Stadium = { venue: string; lat: number; lng: number; city?: string; country?: string; website?: string };
const GROUNDS = STADIUMS as unknown as Record<string, Stadium>;

interface FdTeam { id: number; name: string; shortName?: string; tla?: string; crest?: string }
export interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday?: number | null;
  stage?: string;
  group?: string | null;
  competition?: { code?: string; name?: string };
  homeTeam: FdTeam;
  awayTeam: FdTeam;
}

const STAGE: Record<string, string> = {
  LEAGUE_STAGE: "League phase", GROUP_STAGE: "Group stage", PLAYOFFS: "Play-offs", LAST_32: "Round of 32", LAST_16: "Round of 16",
  QUARTER_FINALS: "Quarter-finals", SEMI_FINALS: "Semi-finals", THIRD_PLACE: "Third place", FINAL: "Final",
};
// Finals and third-place matches are played at neutral venues, not the "home" ground.
const NEUTRAL = new Set(["FINAL", "THIRD_PLACE"]);

/** Pure mapping function — unit-tested with fixtures in tests/lisbon-more.test.ts. */
export function normalizeFootball(raw: FdMatch[], syncedAt: string, grounds: Record<string, Stadium> = GROUNDS, now = Date.now()): ProviderBatch & { skipped: number } {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const participants = new Map<string, Participant>();
  const offers: TicketOffer[] = [];
  const seen = new Set<number>();
  let skipped = 0;
  for (const m of raw) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const start = Date.parse(m.utcDate);
    if (!Number.isFinite(start) || start < now - 3 * 3600000 || ["FINISHED", "IN_PLAY", "PAUSED", "AWARDED", "CANCELLED"].includes(m.status)) continue;
    const g = grounds[String(m.homeTeam?.id)];
    if (!g || (m.stage && NEUTRAL.has(m.stage)) || !m.homeTeam?.name || !m.awayTeam?.name) {
      skipped++;
      continue;
    }
    const cc = g.country ?? "";
    let tz = "UTC";
    try {
      tz = tzlookup(g.lat, g.lng);
    } catch {
      // keep UTC
    }
    const venueId = `fd-v-${m.homeTeam.id}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${g.venue}-${m.homeTeam.id}`),
        name: g.venue,
        city: g.city ?? "",
        cityId: nearestCityId(g.lat, g.lng),
        country: getCountry(cc)?.name ?? cc,
        countryCode: cc,
        lat: g.lat,
        lng: g.lng,
        timeZone: tz,
        venueType: "stadium",
        indoor: false,
        url: g.website,
        provenance: { provider: "football", externalId: String(m.homeTeam.id), lastSyncedAt: syncedAt, isDemo: false },
      });
    const team = (t: FdTeam) => {
      const id = `fd-t-${t.id}`;
      if (!participants.has(id))
        participants.set(id, { id, slug: slugify(`${t.shortName ?? t.name}-${t.id}`), name: t.shortName ?? t.name, kind: "team", imageUrl: t.crest, url: grounds[String(t.id)]?.website, provenance: { provider: "football", externalId: String(t.id), lastSyncedAt: syncedAt, isDemo: false } });
      return id;
    };
    const home = team(m.homeTeam);
    const away = team(m.awayTeam);
    const competition = m.competition?.name ?? "Football";
    const stage = m.stage && STAGE[m.stage] ? STAGE[m.stage] + (m.group ? `, ${m.group.replace(/_/g, " ").toLowerCase()}` : "") : m.matchday ? `Matchday ${m.matchday}` : undefined;
    // "SCHEDULED" at midnight UTC means only the date is fixed.
    const dateOnly = m.status === "SCHEDULED" && /T00:00:00Z$/.test(m.utcDate);
    const id = `fd-e-${m.id}`;
    const title = `${m.homeTeam.shortName ?? m.homeTeam.name} vs ${m.awayTeam.shortName ?? m.awayTeam.name}`;
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${title}-${m.id}`),
      title,
      description: `${competition}${stage ? `, ${stage}` : ""}. ${g.venue}${g.city ? `, ${g.city}` : ""}.`,
      categorySlug: "football",
      groupSlug: "sports",
      eventType: "single",
      venueId,
      start: new Date(start).toISOString(),
      durationMinutes: dateOnly ? 1439 : 110,
      hoursUnknown: dateOnly || undefined,
      timeZone: tz,
      status: m.status === "POSTPONED" ? "postponed" : "scheduled",
      statusNote: dateOnly ? "Kick-off time to be confirmed." : m.status === "SCHEDULED" ? "Kick-off time may still change." : undefined,
      ticketAccess: "ticketed",
      isFree: false,
      registrationRequired: false,
      online: false,
      familyFriendly: false,
      officialUrl: g.website,
      imageUrl: undefined,
      participants: [
        { participantId: home, role: "team_home", order: 0 },
        { participantId: away, role: "team_away", order: 1 },
      ],
      sports: { sport: "Football", competition, stage },
      provenance: { provider: "football", externalId: String(m.id), lastSyncedAt: syncedAt, isDemo: false },
    });
    if (g.website)
      offers.push({
        id: `${id}-club`,
        eventId: id,
        provider: `${m.homeTeam.shortName ?? m.homeTeam.name} (official)`,
        providerType: "primary",
        ticketCategory: "standard",
        label: "Official tickets on the home club's site",
        currency: "",
        availability: "unknown",
        purchaseUrl: g.website,
        isDemo: false,
      });
  }
  return { events, venues: [...venues.values()], participants: [...participants.values()], offers, skipped };
}

async function fetchCompetition(code: string, signal?: AbortSignal): Promise<FdMatch[]> {
  let last = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${BASE}/competitions/${code}/matches?status=SCHEDULED,TIMED,POSTPONED`, {
      headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_KEY! },
      signal,
      next: { revalidate: 3 * 3600 },
    } as RequestInit);
    if (res.ok) return ((await res.json()) as { matches?: FdMatch[] }).matches ?? [];
    last = `HTTP ${res.status}`;
    // 429: per-minute limit. 400 "token is invalid" happens intermittently with valid keys.
    if (res.status === 429 || res.status === 400) await sleep(res.status === 429 ? 61000 : 15000);
    else break;
  }
  throw new Error(`${code}: ${last}`);
}

export const footballProvider: ProviderAdapter = {
  id: "football",
  name: "football-data.org (12 competitions)",
  isDemo: false,
  coverage: "Every scheduled match of the Premier League, Championship, LaLiga, Bundesliga, Serie A, Ligue 1, Eredivisie, Primeira Liga, Brasileirão, Champions League, World Cup and Euros, at the home club's stadium.",
  attribution: "Football data provided by the Football-Data.org API.",
  // Without a key the snapshot is shown, so fixtures appear before the key is set up.
  isConfigured: () => true,
  refreshIntervalMs: 6 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const raw: FdMatch[] = [];
    const failed: string[] = [];
    const snap = SNAPSHOT as unknown as { fetchedAt: string; competitions: Record<string, FdMatch[]> };
    const codes = process.env.FOOTBALL_COMPETITIONS?.split(",").map((s) => s.trim()).filter(Boolean) ?? COMPETITIONS;
    if (!process.env.FOOTBALL_DATA_KEY) {
      for (const code of codes) raw.push(...(snap.competitions[code] ?? []));
      const { skipped, ...batch } = normalizeFootball(raw, syncedAt);
      ctx.log("football: no FOOTBALL_DATA_KEY, using the snapshot", { skipped });
      return { batch, run: { imported: batch.events.length, updated: 0, failures: 0, rateLimited: false, ok: true, finishedAt: new Date().toISOString(), error: `no FOOTBALL_DATA_KEY set; showing the snapshot from ${snap.fetchedAt.slice(0, 16).replace("T", " ")} UTC` } };
    }
    // The free plan allows 10 requests a minute, so reading all competitions takes over a
    // minute. Show the snapshot straight away and swap in live data competition by competition.
    const byCode = new Map(codes.map((c) => [c, snap.competitions[c] ?? []]));
    const publish = () => {
      const { events, venues, participants, offers } = normalizeFootball([...byCode.values()].flat(), syncedAt);
      ctx.onProgress?.({ events, venues, participants, offers });
    };
    publish();
    for (const code of codes) {
      try {
        byCode.set(code, await fetchCompetition(code, ctx.signal));
        publish();
      } catch (err) {
        failed.push(code);
        ctx.log("football competition failed", { code, err: String(err) });
      }
      await sleep(6500);
    }
    raw.push(...[...byCode.values()].flat());
    const { skipped, ...batch } = normalizeFootball(raw, syncedAt);
    if (skipped) ctx.log("football matches without a located ground", { skipped });
    return {
      batch,
      run: {
        imported: batch.events.length,
        updated: 0,
        failures: failed.length,
        rateLimited: false,
        ok: batch.events.length > 0,
        finishedAt: new Date().toISOString(),
        error: failed.length ? `live data unavailable for ${failed.join(", ")}; showing the snapshot from ${snap.fetchedAt.slice(0, 16).replace("T", " ")} UTC` : undefined,
      },
    };
  },
};
