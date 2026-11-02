import "server-only";
import { createHash } from "node:crypto";
import type { EventCard } from "../types";
import type { Duel, DuelPick, DuelRound, DuelSide } from "./types";
import { cmd, pairs, pipe, type Cmd } from "./kv";
import { CommunityError, getProfile, limit, memberOf } from "./service";

/**
 * The daily duel: three rounds of "this or that" between two events coming up in one city,
 * the same for everyone that day. Pick one and see how everyone else picked. Playing on
 * consecutive days builds a streak; members earn a point a day and, after seven days, the
 * Duelist badge.
 *
 * - The city changes every day. The rounds are worked out once, by the first server asked,
 *   and kept, so every server shows the same ones.
 * - One pick per person and round, final. How others voted shows only after picking.
 * - Days run from midnight to midnight UTC.
 */

export const ROUNDS = 3;
const TTL = 9 * 86400;
/** Cities with plenty on, in the order the duel visits them. */
export const DUEL_CITIES = ["lisbon", "madrid", "paris", "porto", "barcelona", "london", "berlin", "new-york", "valencia", "amsterdam", "chicago", "rome", "helsinki", "montreal"];

const DAY = 86400000;
export const dayOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY);
const rank = (day: string, id: string) => createHash("sha256").update(`${day}|${id}`).digest().readUInt32BE(0);

const side = (c: EventCard): DuelSide => ({
  id: c.id,
  slug: c.slug,
  title: c.title,
  start: c.start,
  timeZone: c.timeZone,
  hoursUnknown: c.hoursUnknown || undefined,
  venueName: c.venueName,
  city: c.city,
  imageUrl: c.imageUrl,
  hue: c.posterHue,
  categorySlug: c.categorySlug,
  groupSlug: c.groupSlug,
  isFree: c.isFree || undefined,
});

/**
 * Picks the day's rounds from a city's coming events: real ones with a picture first, each
 * round two different kinds of thing (a concert against a play, say), no event twice.
 * Pure: the same day and events always give the same rounds.
 */
export function pickRounds(day: string, cards: EventCard[]): DuelRound[] {
  const seen = new Set<string>();
  const ok = cards.filter((c) => {
    const key = c.title.toLowerCase().replace(/\W+/g, " ").trim();
    if (c.status === "cancelled" || c.status === "postponed" || c.eventType === "daily_attraction" || c.ongoing || c.online || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const real = ok.filter((c) => !c.isDemo);
  const pool = (real.length >= ROUNDS * 2 ? real : ok)
    .map((c) => ({ c, r: rank(day, c.id) + (c.imageUrl ? 0 : 2 ** 32) }))
    .sort((x, y) => x.r - y.r)
    .map((x) => x.c);
  const rounds: DuelRound[] = [];
  const used = new Set<string>();
  const pairsSeen = new Set<string>();
  for (const a of pool) {
    if (rounds.length === ROUNDS) break;
    if (used.has(a.id)) continue;
    // Prefer a kind of event not yet matched against this one today.
    const b =
      pool.find((x) => !used.has(x.id) && x.id !== a.id && x.groupSlug !== a.groupSlug && !pairsSeen.has([a.groupSlug, x.groupSlug].sort().join("|"))) ??
      pool.find((x) => !used.has(x.id) && x.id !== a.id && x.groupSlug !== a.groupSlug);
    if (!b) continue;
    used.add(a.id).add(b.id);
    pairsSeen.add([a.groupSlug, b.groupSlug].sort().join("|"));
    rounds.push({ a: side(a), b: side(b) });
  }
  return rounds;
}

type Stored = { day: string; cityId: string; city: string; rounds: DuelRound[] };
type Streak = { last: string; days: number; best: number };

const json = <T,>(v: unknown): T | undefined => {
  if (typeof v !== "string") return undefined;
  try {
    return JSON.parse(v) as T;
  } catch {
    return undefined;
  }
};

/** Coming events in a city, best first; the route reads them from the catalogue. */
export type DuelSource = (cityId: string, from: string, to: string) => Promise<{ city: string; cards: EventCard[] }>;

/** The day's duel as kept, making it on first use. */
async function stored(day: string, source?: DuelSource): Promise<Stored | undefined> {
  const have = json<Stored>(await cmd(["GET", `c:duel:${day}`]));
  if (have || !source) return have;
  const n = dayNumber(day);
  const to = dayOf(Date.parse(`${day}T00:00:00Z`) + 7 * DAY);
  for (let i = 0; i < DUEL_CITIES.length; i++) {
    const cityId = DUEL_CITIES[(n + i) % DUEL_CITIES.length];
    const { city, cards } = await source(cityId, day, to);
    const rounds = pickRounds(day, cards);
    if (rounds.length < ROUNDS) continue;
    // Whoever saves first wins, so every server shows the same duel.
    await cmd(["SET", `c:duel:${day}`, JSON.stringify({ day, cityId, city, rounds }), "NX", "EX", TTL]);
    return json<Stored>(await cmd(["GET", `c:duel:${day}`]));
  }
  return undefined;
}

const streakOf = (s: Streak | undefined, today: string, yesterday: string) => {
  const alive = s && (s.last === today || s.last === yesterday);
  return { days: alive ? s.days : 0, best: s?.best ?? 0, playedToday: s?.last === today };
};

/** Today's duel for a viewer (signed in or not), or undefined when no city has enough on. */
export async function getDuel(viewer: string | undefined, source?: DuelSource, now = Date.now()): Promise<Duel | undefined> {
  const day = dayOf(now);
  const yesterday = dayOf(now - DAY);
  const duel = await stored(day, source);
  if (!duel) return undefined;
  const res = await pipe([
    ["HGETALL", `c:dc:${day}`],
    viewer ? ["HMGET", `c:dv:${day}`, ...duel.rounds.map((_, i) => `${i}:${viewer}`)] : ["GET", "c:none"],
    viewer ? ["GET", `c:dstk:${viewer}`] : ["GET", "c:none"],
    ["GET", `c:duel:${yesterday}`],
    ["HGETALL", `c:dc:${yesterday}`],
  ]);
  const counts = pairs(res[0]);
  const mine = Array.isArray(res[1]) ? (res[1] as (string | null)[]) : [];
  const rounds = duel.rounds.map((r, i): DuelRound => {
    const pick = mine[i] === "a" || mine[i] === "b" ? (mine[i] as DuelPick) : undefined;
    return pick ? { ...r, mine: pick, votes: { a: Number(counts[`${i}|a`] ?? 0), b: Number(counts[`${i}|b`] ?? 0) } } : { a: r.a, b: r.b };
  });
  const before = json<Stored>(res[3]);
  const past = pairs(res[4]);
  const winners = (before?.rounds ?? [])
    .map((r, i) => {
      const a = Number(past[`${i}|a`] ?? 0);
      const b = Number(past[`${i}|b`] ?? 0);
      if (a + b === 0) return undefined;
      const w = a >= b ? r.a : r.b;
      return { ...w, votes: a + b, pct: Math.round((Math.max(a, b) / (a + b)) * 100) };
    })
    .filter((w) => w !== undefined);
  return {
    day,
    cityId: duel.cityId,
    city: duel.city,
    rounds,
    players: Number(counts.players ?? 0),
    streak: streakOf(json<Streak>(res[2]), day, yesterday),
    yesterday: before && winners.length ? { city: before.city, winners } : undefined,
    nextAt: new Date(Date.parse(`${day}T00:00:00Z`) + DAY).toISOString(),
  };
}

/** Records a pick. A second pick for the same round keeps the first. */
export async function voteDuel(secret: string, input: { day?: unknown; round?: unknown; pick?: unknown }, ip: string, now = Date.now()): Promise<{ votes: { a: number; b: number }; mine: DuelPick; streak: Duel["streak"]; players: number }> {
  const voter = await memberOf(secret);
  if (!voter) throw new CommunityError("Reload the page and try again.", 401);
  const day = dayOf(now);
  if (input.day !== day) throw new CommunityError("A new duel has started. Reload to play it!", 409);
  const duel = await stored(day);
  const round = Number(input.round);
  if (!duel || !Number.isInteger(round) || round < 0 || round >= duel.rounds.length) throw new CommunityError("That round isn't part of today's duel.", 404);
  if (input.pick !== "a" && input.pick !== "b") throw new CommunityError("Pick one of the two.");
  await limit(`ip:${ip}:duel`, 60, 3600);
  const yesterday = dayOf(now - DAY);
  const [added, prevPick, rawStreak] = await pipe([
    ["HSETNX", `c:dv:${day}`, `${round}:${voter}`, input.pick],
    ["HGET", `c:dv:${day}`, `${round}:${voter}`],
    ["GET", `c:dstk:${voter}`],
  ]);
  const mine = (prevPick === "a" || prevPick === "b" ? prevPick : input.pick) as DuelPick;
  let streak = json<Streak>(rawStreak);
  const cmds: Cmd[] = [];
  if (Number(added) === 1) {
    cmds.push(["HINCRBY", `c:dc:${day}`, `${round}|${mine}`, 1], ["EXPIRE", `c:dc:${day}`, TTL], ["EXPIRE", `c:dv:${day}`, TTL]);
    // The first pick of the day counts the player and moves the streak on.
    if (streak?.last !== day) {
      const days = streak?.last === yesterday ? streak.days + 1 : 1;
      streak = { last: day, days, best: Math.max(days, streak?.best ?? 0) };
      cmds.push(["HINCRBY", `c:dc:${day}`, "players", 1], ["SET", `c:dstk:${voter}`, JSON.stringify(streak), "EX", 400 * 86400]);
      // Members earn a point a day and count towards the Duelist badge.
      if ((await getProfile(voter))?.username) cmds.push(["HINCRBY", `c:uc:${voter}`, "duels", 1], ["ZINCRBY", "c:karma", 1, voter]);
    }
  }
  const res = await pipe([...cmds, ["HGETALL", `c:dc:${day}`]]);
  const counts = pairs(res[res.length - 1]);
  return {
    votes: { a: Number(counts[`${round}|a`] ?? 0), b: Number(counts[`${round}|b`] ?? 0) },
    mine,
    streak: streakOf(streak, day, yesterday),
    players: Number(counts.players ?? 0),
  };
}
