import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cmd, pipe, type Cmd } from "./kv";
import { checkSafety, CommunityError, getProfiles, json, limit, memberOf, requireProfile } from "./service";
import type { PublicProfile } from "./types";

/**
 * Trips people share with everyone: a route (its stops and nights), a name, a few words and the
 * places worth seeing on the way. Others browse them, like them, and plan their own from one.
 *
 * - Sharing needs an account; up to 30 shared trips each, 10 a day. Texts follow the community's
 *   safety rules (no phone numbers, emails, handles or ticket selling).
 * - A shared trip is hidden once three members report it.
 * - Keys: c:st:<id> (JSON), c:sts:new / c:sts:top (zsets), c:ust:<member> (set of ids),
 *   c:stlk:<id> (likers), c:stuse:<id> (who planned from it, hashed), c:strep:<id> (reporters).
 */

export interface SharedStop {
  name: string;
  cc?: string;
  lat: number;
  lng: number;
  nights: number;
  cityId?: string;
  /** Places worth seeing there (titles only). */
  see?: string[];
}
export interface SharedTrip {
  id: string;
  author: string;
  name: string;
  emoji: string;
  about: string;
  stops: SharedStop[];
  nights: number;
  km: number;
  /** The month it was (or will be) made, 1–12. */
  month?: number;
  createdAt: string;
  updatedAt: string;
  hidden?: boolean;
}
export interface SharedTripCard extends SharedTrip {
  by?: PublicProfile;
  likes: number;
  uses: number;
  liked?: boolean;
  mine?: boolean;
}

const MAX_OWN = 30;
const now = () => new Date().toISOString();
const ID_RE = /^[a-f0-9]{12}$/;
const km = (a: SharedStop, b: SharedStop) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
const line = (raw: unknown, max: number) =>
  String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** A shared trip as sent by a browser, checked and cleaned (throws on anything wrong). */
export function cleanSharedTrip(input: Record<string, unknown>): Omit<SharedTrip, "id" | "author" | "createdAt" | "updatedAt"> {
  const name = line(input.name, 80);
  if (name.length < 3) throw new CommunityError("Give the trip a name (3 characters or more).");
  const about = String(input.about ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (about.length > 600) throw new CommunityError("Keep the description under 600 characters.");
  if ((about.match(/https?:\/\/|www\./g) ?? []).length > 0) throw new CommunityError("Links can't go in a shared trip.");
  const emoji = String(input.emoji ?? "✈️");
  const okEmoji = [...emoji].length <= 4 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(emoji) && !/[A-Za-z0-9<>]/.test(emoji);
  const rawStops = Array.isArray(input.stops) ? input.stops.slice(0, 13) : [];
  if (!rawStops.length) throw new CommunityError("A shared trip needs at least one city.");
  if (rawStops.length > 12) throw new CommunityError("Up to 12 cities in a shared trip.");
  const stops: SharedStop[] = rawStops.map((s: unknown) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const lat = Number(o.lat);
    const lng = Number(o.lng);
    const nights = Number(o.nights);
    const n = line(o.name, 60);
    if (!n || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new CommunityError("One of the cities isn't right. Check the route and try again.");
    const see = (Array.isArray(o.see) ? o.see : []).map((x) => line(x, 80)).filter((x) => x.length >= 2).slice(0, 8);
    return {
      name: n,
      cc: typeof o.cc === "string" && /^[A-Z]{2}$/.test(o.cc) ? o.cc : undefined,
      lat: Math.round(lat * 1000) / 1000,
      lng: Math.round(lng * 1000) / 1000,
      nights: Number.isInteger(nights) && nights >= 0 && nights <= 60 ? nights : 1,
      cityId: typeof o.cityId === "string" && /^[a-z0-9-]{1,40}$/.test(o.cityId) ? o.cityId : undefined,
      ...(see.length ? { see } : {}),
    };
  });
  checkSafety([name, about, ...stops.flatMap((s) => [s.name, ...(s.see ?? [])])].join("\n"));
  const month = Number(input.month);
  let dist = 0;
  for (let i = 1; i < stops.length; i++) dist += km(stops[i - 1], stops[i]);
  return {
    name,
    emoji: okEmoji ? emoji : "✈️",
    about,
    stops,
    nights: stops.reduce((a, s) => a + s.nights, 0),
    km: Math.round(dist),
    ...(Number.isInteger(month) && month >= 1 && month <= 12 ? { month } : {}),
  };
}

const score = (likes: number, uses: number) => likes * 3 + uses;

async function load(ids: string[]): Promise<SharedTrip[]> {
  if (!ids.length) return [];
  const res = (await cmd<unknown[]>(["MGET", ...ids.map((id) => `c:st:${id}`)])) ?? [];
  return res.map((v) => json<SharedTrip>(v)).filter((t): t is SharedTrip => !!t);
}

async function cards(trips: SharedTrip[], viewer?: string): Promise<SharedTripCard[]> {
  const shown = trips.filter((t) => !t.hidden || t.author === viewer);
  if (!shown.length) return [];
  const res = await pipe(shown.flatMap((t): Cmd[] => [["SCARD", `c:stlk:${t.id}`], ["SCARD", `c:stuse:${t.id}`], viewer ? ["SISMEMBER", `c:stlk:${t.id}`, viewer] : ["GET", "c:none"]]));
  const profiles = await getProfiles(shown.map((t) => t.author));
  return shown.map((t, i) => ({
    ...t,
    by: profiles[t.author],
    likes: Number(res[i * 3] ?? 0),
    uses: Number(res[i * 3 + 1] ?? 0),
    liked: Number(res[i * 3 + 2]) === 1 || undefined,
    mine: t.author === viewer || undefined,
  }));
}

/** Shared trips, the most liked or the newest first. */
export async function listSharedTrips(opts: { sort?: "top" | "new"; offset?: number; limit?: number; viewer?: string }): Promise<{ trips: SharedTripCard[]; total: number }> {
  const key = opts.sort === "new" ? "c:sts:new" : "c:sts:top";
  const off = Math.max(0, Math.min(1000, Math.floor(opts.offset ?? 0)));
  const n = Math.max(1, Math.min(48, Math.floor(opts.limit ?? 24)));
  const [ids, total] = await pipe([["ZREVRANGE", key, off, off + n - 1], ["ZCARD", "c:sts:new"]]);
  return { trips: await cards(await load(((ids as string[]) ?? []).filter(Boolean)), opts.viewer), total: Number(total ?? 0) };
}

export async function getSharedTrip(id: string, viewer?: string): Promise<SharedTripCard | undefined> {
  if (!ID_RE.test(id)) return undefined;
  const [t] = await load([id]);
  if (!t) return undefined;
  return (await cards([t], viewer))[0];
}

/** The caller's own shared trips. */
export async function mySharedTrips(secret: string): Promise<SharedTripCard[]> {
  const me = await memberOf(secret);
  if (!me) return [];
  const ids = ((await cmd<string[]>(["SMEMBERS", `c:ust:${me}`])) ?? []).filter((x) => ID_RE.test(x));
  return (await cards(await load(ids), me)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Share a trip (or update one already shared, by its id). */
export async function shareTrip(secret: string, input: Record<string, unknown>): Promise<SharedTripCard> {
  const me = await requireProfile(secret);
  const clean = cleanSharedTrip(input);
  const id = typeof input.id === "string" && ID_RE.test(input.id) ? input.id : undefined;
  if (id) {
    const [old] = await load([id]);
    if (!old) throw new CommunityError("That shared trip is gone.", 404);
    if (old.author !== me.id) throw new CommunityError("Only who shared a trip can change it.", 403);
    await limit(`u:${me.id}:stedit`, 60, 3600);
    const next: SharedTrip = { ...old, ...clean, updatedAt: now() };
    await cmd(["SET", `c:st:${id}`, JSON.stringify(next)]);
    return (await cards([next], me.id))[0];
  }
  const own = Number(await cmd(["SCARD", `c:ust:${me.id}`]));
  if (own >= MAX_OWN) throw new CommunityError(`You've shared ${MAX_OWN} trips: take one down to share another.`);
  await limit(`u:${me.id}:stnew`, 10, 86400);
  const trip: SharedTrip = { id: randomBytes(6).toString("hex"), author: me.id, ...clean, createdAt: now(), updatedAt: now() };
  await pipe([
    ["SET", `c:st:${trip.id}`, JSON.stringify(trip)],
    ["ZADD", "c:sts:new", Date.now(), trip.id],
    ["ZADD", "c:sts:top", score(0, 0), trip.id],
    ["SADD", `c:ust:${me.id}`, trip.id],
  ]);
  return (await cards([trip], me.id))[0];
}

/** Take a shared trip down (its author only). */
export async function unshareTrip(secret: string, id: unknown) {
  const me = await requireProfile(secret);
  if (typeof id !== "string" || !ID_RE.test(id)) throw new CommunityError("That shared trip is gone.", 404);
  const [t] = await load([id]);
  if (!t) return;
  if (t.author !== me.id) throw new CommunityError("Only who shared a trip can take it down.", 403);
  await pipe([
    ["DEL", `c:st:${id}`, `c:stlk:${id}`, `c:stuse:${id}`, `c:strep:${id}`],
    ["ZREM", "c:sts:new", id],
    ["ZREM", "c:sts:top", id],
    ["SREM", `c:ust:${me.id}`, id],
  ]);
}

async function rescore(id: string) {
  const [l, u] = await pipe([["SCARD", `c:stlk:${id}`], ["SCARD", `c:stuse:${id}`]]);
  await cmd(["ZADD", "c:sts:top", score(Number(l ?? 0), Number(u ?? 0)), id]);
}

/** Like a shared trip, or take the like back. */
export async function likeSharedTrip(secret: string, id: unknown): Promise<{ liked: boolean; likes: number }> {
  const me = await requireProfile(secret);
  const t = typeof id === "string" ? await getSharedTrip(id, me.id) : undefined;
  if (!t || t.hidden) throw new CommunityError("That shared trip is gone.", 404);
  await limit(`u:${me.id}:stlike`, 200, 3600);
  const liked = !t.liked;
  const [, n] = await pipe([[liked ? "SADD" : "SREM", `c:stlk:${t.id}`, me.id], ["SCARD", `c:stlk:${t.id}`]]);
  await rescore(t.id);
  return { liked, likes: Number(n ?? 0) };
}

/** Someone planned a trip from this one (counted once per member or address). */
export async function usedSharedTrip(id: unknown, who: string) {
  if (typeof id !== "string" || !ID_RE.test(id)) return;
  const [t] = await load([id]);
  if (!t || t.hidden) return;
  const tag = createHash("sha256").update(`st:${who}`).digest("hex").slice(0, 12);
  const [added] = await pipe([["SADD", `c:stuse:${id}`, tag]]);
  if (Number(added)) await rescore(id);
}

/** Report a shared trip; three reports hide it. */
export async function reportSharedTrip(secret: string, id: unknown) {
  const me = await requireProfile(secret);
  if (typeof id !== "string" || !ID_RE.test(id)) return;
  const [t] = await load([id]);
  if (!t) return;
  if (t.author === me.id) throw new CommunityError("It's your own trip: you can change it or take it down.");
  await limit(`u:${me.id}:report`, 20, 3600);
  const [, n] = await pipe([["SADD", `c:strep:${id}`, me.id], ["SCARD", `c:strep:${id}`]]);
  if (Number(n) >= 3 && !t.hidden) await pipe([["SET", `c:st:${id}`, JSON.stringify({ ...t, hidden: true })], ["ZREM", "c:sts:top", id], ["ZREM", "c:sts:new", id]]);
}
