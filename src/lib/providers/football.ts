import { slugify } from "../destinations";
import type { OmniEvent, Participant, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, nearestCityId, sleep } from "./common";

/**
 * Football fixtures from football-data.org (v4).
 *
 * - Requires FOOTBALL_DATA_KEY (free account at https://www.football-data.org/client/register).
 *   The free tier covers the Primeira Liga and the Champions League, 10 requests a minute.
 * - Matches are placed at the home club's stadium, from a hand-checked table of Portuguese
 *   grounds (OpenStreetMap). Matches whose home ground we don't know are skipped, not guessed.
 * - Ticket prices aren't published by this source; event pages link to sellers' searches.
 */

const BASE = "https://api.football-data.org/v4";
const TZ = "Europe/Lisbon";

type Ground = { name: string; city: string; lat: number; lng: number };
// Most specific patterns first: "Sporting Clube de Braga" must not match Sporting CP.
const GROUNDS: [RegExp, Ground][] = [
  [/braga/, { name: "Estádio Municipal de Braga", city: "Braga", lat: 41.5625, lng: -8.42987 }],
  [/vit[oó]ria (sc|sport clube)|guimar/, { name: "Estádio D. Afonso Henriques", city: "Guimarães", lat: 41.44585, lng: -8.30099 }],
  [/set[uú]bal/, { name: "Estádio do Bonfim", city: "Setúbal", lat: 38.53134, lng: -8.89118 }],
  [/benfica/, { name: "Estádio da Luz", city: "Lisbon", lat: 38.75269, lng: -9.18469 }],
  [/sporting (clube de portugal|cp)|^sporting$/, { name: "Estádio José Alvalade", city: "Lisbon", lat: 38.7612, lng: -9.16078 }],
  [/\bporto\b/, { name: "Estádio do Dragão", city: "Porto", lat: 41.16182, lng: -8.58375 }],
  [/estoril/, { name: "Estádio António Coimbra da Mota", city: "Estoril", lat: 38.71586, lng: -9.40641 }],
  [/rio ave/, { name: "Estádio do Rio Ave FC", city: "Vila do Conde", lat: 41.36275, lng: -8.74015 }],
  [/famalic/, { name: "Estádio Municipal 22 de Junho", city: "Vila Nova de Famalicão", lat: 41.40125, lng: -8.52244 }],
  [/gil vicente/, { name: "Estádio Cidade de Barcelos", city: "Barcelos", lat: 41.5511, lng: -8.62309 }],
  [/moreirense/, { name: "Estádio Comendador Joaquim de Almeida Freitas", city: "Moreira de Cónegos", lat: 41.37803, lng: -8.355 }],
  [/arouca/, { name: "Estádio Municipal de Arouca", city: "Arouca", lat: 40.93229, lng: -8.25043 }],
  [/santa clara/, { name: "Estádio de São Miguel", city: "Ponta Delgada", lat: 37.76386, lng: -25.62259 }],
  [/nacional/, { name: "Estádio da Madeira", city: "Funchal", lat: 32.67062, lng: -16.88356 }],
  [/mar[ií]timo/, { name: "Estádio do Marítimo", city: "Funchal", lat: 32.64557, lng: -16.92839 }],
  [/estrela/, { name: "Estádio José Gomes", city: "Amadora", lat: 38.75216, lng: -9.228 }],
  [/tondela/, { name: "Estádio João Cardoso", city: "Tondela", lat: 40.512, lng: -8.08279 }],
  [/alverca/, { name: "Complexo Desportivo FC Alverca", city: "Alverca do Ribatejo", lat: 38.89758, lng: -9.03516 }],
  [/\bavs\b|\baves\b/, { name: "Estádio do CD Aves", city: "Vila das Aves", lat: 41.36676, lng: -8.4117 }],
  [/boavista/, { name: "Estádio do Bessa", city: "Porto", lat: 41.1622, lng: -8.6426 }],
  [/pa[cç]os de ferreira/, { name: "Estádio Capital do Móvel", city: "Paços de Ferreira", lat: 41.27148, lng: -8.38538 }],
  [/chaves/, { name: "Estádio Municipal de Chaves", city: "Chaves", lat: 41.75063, lng: -7.46498 }],
  [/portimonense/, { name: "Estádio Municipal de Portimão", city: "Portimão", lat: 37.13569, lng: -8.53983 }],
  [/beira-mar/, { name: "Estádio Municipal de Aveiro", city: "Aveiro", lat: 40.64777, lng: -8.59371 }],
  [/belenenses/, { name: "Estádio do Restelo", city: "Lisbon", lat: 38.70258, lng: -9.20793 }],
];

export function groundFor(teamName: string): Ground | undefined {
  const n = teamName.toLowerCase();
  return GROUNDS.find(([re]) => re.test(n))?.[1];
}

interface FdTeam { id: number; name: string; shortName?: string; tla?: string; crest?: string }
export interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday?: number | null;
  stage?: string;
  competition?: { code?: string; name?: string };
  homeTeam: FdTeam;
  awayTeam: FdTeam;
}

const STAGE: Record<string, string> = { REGULAR_SEASON: "", LEAGUE_STAGE: "League phase", PLAYOFFS: "Play-offs", LAST_16: "Round of 16", QUARTER_FINALS: "Quarter-finals", SEMI_FINALS: "Semi-finals", FINAL: "Final" };

/** Pure mapping function — unit-tested with fixtures in tests/football.test.ts. */
export function normalizeFootball(raw: FdMatch[], syncedAt: string): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const participants = new Map<string, Participant>();
  for (const m of raw) {
    const ground = groundFor(m.homeTeam?.name ?? "") ?? groundFor(m.homeTeam?.shortName ?? "");
    const start = Date.parse(m.utcDate);
    if (!ground || !Number.isFinite(start) || ["FINISHED", "IN_PLAY", "PAUSED", "AWARDED"].includes(m.status)) continue;
    const venueId = `fd-v-${slugify(ground.name)}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(ground.name),
        name: ground.name,
        city: ground.city,
        cityId: nearestCityId(ground.lat, ground.lng),
        country: "Portugal",
        countryCode: "PT",
        lat: ground.lat,
        lng: ground.lng,
        timeZone: m.homeTeam && /santa clara/i.test(m.homeTeam.name) ? "Atlantic/Azores" : m.homeTeam && /nacional|mar[ií]timo/i.test(m.homeTeam.name) ? "Atlantic/Madeira" : TZ,
        venueType: "stadium",
        indoor: false,
        provenance: { provider: "football", externalId: venueId, lastSyncedAt: syncedAt, isDemo: false },
      });
    const team = (t: FdTeam) => {
      const id = `fd-t-${t.id}`;
      if (!participants.has(id))
        participants.set(id, { id, slug: slugify(`${t.shortName ?? t.name}-${t.id}`), name: t.shortName ?? t.name, kind: "team", imageUrl: t.crest, provenance: { provider: "football", externalId: String(t.id), lastSyncedAt: syncedAt, isDemo: false } });
      return id;
    };
    const home = team(m.homeTeam);
    const away = team(m.awayTeam);
    const competition = m.competition?.name ?? "Football";
    const stage = m.stage && STAGE[m.stage] !== "" ? STAGE[m.stage] ?? m.stage.replace(/_/g, " ").toLowerCase() : m.matchday ? `Matchday ${m.matchday}` : undefined;
    const id = `fd-e-${m.id}`;
    const status = m.status === "POSTPONED" ? "postponed" : m.status === "CANCELLED" ? "cancelled" : "scheduled";
    const title = `${m.homeTeam.shortName ?? m.homeTeam.name} vs ${m.awayTeam.shortName ?? m.awayTeam.name}`;
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${title}-${m.id}`),
      title,
      categorySlug: "football",
      groupSlug: "sports",
      eventType: "single",
      venueId,
      start: new Date(start).toISOString(),
      durationMinutes: 110,
      timeZone: venues.get(venueId)!.timeZone,
      status,
      // "SCHEDULED" means the date is set but the kick-off time isn't confirmed yet.
      statusNote: m.status === "SCHEDULED" ? "Kick-off time to be confirmed." : undefined,
      ticketAccess: "ticketed",
      isFree: false,
      registrationRequired: false,
      online: false,
      familyFriendly: false,
      participants: [
        { participantId: home, role: "team_home", order: 0 },
        { participantId: away, role: "team_away", order: 1 },
      ],
      sports: { sport: "Football", competition, stage },
      provenance: { provider: "football", externalId: String(m.id), lastSyncedAt: syncedAt, isDemo: false },
    });
  }
  return { events, venues: [...venues.values()], participants: [...participants.values()], offers: [] };
}

export const footballProvider: ProviderAdapter = {
  id: "football",
  name: "football-data.org (Primeira Liga, Champions League)",
  isDemo: false,
  coverage: "Primeira Liga fixtures and Champions League home matches of Portuguese clubs.",
  attribution: "Football data provided by the Football-Data.org API.",
  isConfigured: () => !!process.env.FOOTBALL_DATA_KEY,
  refreshIntervalMs: 6 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const raw: FdMatch[] = [];
    let failures = 0;
    let lastError = "";
    for (const code of (process.env.FOOTBALL_COMPETITIONS ?? "PPL,CL").split(",").map((s) => s.trim()).filter(Boolean)) {
      try {
        const json = (await fetchJson("football", `${BASE}/competitions/${code}/matches?status=SCHEDULED,TIMED,POSTPONED`, ctx, { headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_KEY! }, revalidate: 3 * 3600 })) as { matches?: FdMatch[] };
        raw.push(...(json.matches ?? []));
      } catch (err) {
        failures++;
        lastError = `${code}: ${String(err).slice(0, 140)}`;
      }
      await sleep(6500); // free tier: 10 requests a minute
    }
    const batch = normalizeFootball(raw, syncedAt);
    return {
      batch,
      run: { imported: batch.events.length, updated: 0, failures, rateLimited: false, ok: batch.events.length > 0 || failures === 0, finishedAt: new Date().toISOString(), error: failures ? `${failures} competition(s) failed (last: ${lastError})` : undefined },
    };
  },
};
