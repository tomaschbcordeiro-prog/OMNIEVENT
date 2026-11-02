import "server-only";
import { randomBytes } from "node:crypto";
import type { EventCard } from "../types";
import { GROUPS } from "../categories";
import { getDestination, slugify } from "../destinations";
import { cmd, pairs, pipe, type Cmd } from "./kv";
import { CommunityError, checkSafety, cleanText, getProfiles, json, limit, memberOf, notice, removeWallPost, requireProfile } from "./service";
import { CLUB_EMOJIS, type Club, type ClubCard, type ClubDirectory, type ClubPage, type ClubPick, type ClubPrivacy, type ClubRole, type Notice, type TargetMeta } from "./types";

/**
 * Clubs: groups of people who share a taste ("Lisbon jazz nights", "Indie film Sundays").
 *
 * - Any member with an account can found a club (up to three) and becomes its owner. Owners
 *   name admins; owners and admins approve join requests, remove members and posts, and edit
 *   the club. The owner can hand the club over, or close it.
 * - Open clubs: anyone joins, and everyone can read the wall and see who's in. Request-only
 *   clubs: people ask to join; the wall, members and shared events are for members only.
 * - The wall is a community conversation on the target `k:<club id>` (members post; it never
 *   reaches the community feed). Members share upcoming events with the club ("picks") and
 *   vote for the ones they'd go to together. The club's taste comes from its vibes and picks.
 *
 * Keys: c:club:<id> (JSON), c:clubslug:<slug> → id, c:clubm:<id> member → "role|since",
 * c:clubreq:<id> member → asked at, c:clubban:<id> (set), c:uclubs:<member> (set of ids),
 * c:uowned:<member> (set of ids), c:clubs:new / c:clubs:size (zsets), c:clubface:<id> (recent
 * joiners), c:clubpk:<id> event → votes (zset), c:clubpkby:<id> event → pick JSON,
 * c:clubpkv:<id>:<event> (voters).
 */

const MAX_OWNED = 3;
const MAX_JOINED = 40;
const MAX_PICKS = 120;
const VIBES = new Set(GROUPS.map((g) => g.slug));
const RESERVED = /\b(omnievent|official|admin|moderator|staff|support)\b/i;

const now = () => new Date().toISOString();
export const wallOf = (id: string) => `k:${id}`;

type Stored = Club;

// ---- Reading ---------------------------------------------------------------------------------

async function loadClubs(ids: string[]): Promise<Club[]> {
  if (!ids.length) return [];
  const res = (await cmd<unknown[]>(["MGET", ...ids.map((id) => `c:club:${id}`)])) ?? [];
  return res.map((v) => json<Stored>(v)).filter((c): c is Club => !!c);
}

async function clubBySlug(slug: string): Promise<Club | undefined> {
  const id = await cmd<string | null>(["GET", `c:clubslug:${slugify(slug)}`]);
  return id ? (await loadClubs([id]))[0] : undefined;
}

async function requireClub(id: unknown): Promise<Club> {
  const c = typeof id === "string" && /^[a-f0-9]{16}$/.test(id) ? (await loadClubs([id]))[0] : undefined;
  if (!c) throw new CommunityError("That club doesn't exist any more.", 404);
  return c;
}

const parseRole = (v: unknown): { role: ClubRole; since: string } | undefined => {
  if (typeof v !== "string") return undefined;
  const [role, since] = v.split("|");
  return role === "owner" || role === "admin" || role === "member" ? { role, since: since ?? "" } : undefined;
};

/** The viewer's role in a club, if any. */
export async function roleIn(clubId: string, who?: string): Promise<ClubRole | undefined> {
  if (!who) return undefined;
  return parseRole(await cmd(["HGET", `c:clubm:${clubId}`, who]))?.role;
}

/** Cards for a list of clubs: member counts, a few faces, and the viewer's place. */
async function cards(clubs: Club[], viewer?: string): Promise<ClubCard[]> {
  if (!clubs.length) return [];
  const res = await pipe(
    clubs.flatMap((c): Cmd[] => [
      ["ZSCORE", "c:clubs:size", c.id],
      ["ZCARD", `c:clubpk:${c.id}`],
      ["LRANGE", `c:clubface:${c.id}`, 0, 5],
      viewer ? ["HGET", `c:clubm:${c.id}`, viewer] : ["GET", "c:none"],
      viewer ? ["HGET", `c:clubreq:${c.id}`, viewer] : ["GET", "c:none"],
    ]),
  );
  // Recent joiners who are still members.
  const recent = clubs.map((_, i) => [...new Set(((res[i * 5 + 2] as string[]) ?? []).filter(Boolean))]);
  const still = await pipe(clubs.map((c, i): Cmd => (recent[i].length ? ["HMGET", `c:clubm:${c.id}`, ...recent[i]] : ["GET", "c:none"])));
  const faceIds = recent.map((ids, i) => ids.filter((_, j) => Array.isArray(still[i]) && typeof (still[i] as unknown[])[j] === "string"));
  const profiles = await getProfiles(faceIds.flat());
  return clubs.map((c, i) => ({
    ...c,
    members: Math.max(0, Math.round(Number(res[i * 5] ?? 0))),
    picks: Number(res[i * 5 + 1] ?? 0),
    faces: faceIds[i].map((id) => profiles[id]).filter(Boolean).slice(0, 5),
    myRole: parseRole(res[i * 5 + 3])?.role,
    requested: typeof res[i * 5 + 4] === "string" || undefined,
  }));
}

/** The clubs page: the viewer's clubs, the biggest, and the newest. */
export async function getClubDirectory(viewer?: string): Promise<ClubDirectory> {
  const [popular, fresh, mine, total] = await pipe([
    ["ZREVRANGE", "c:clubs:size", 0, 47],
    ["ZREVRANGE", "c:clubs:new", 0, 23],
    viewer ? ["SMEMBERS", `c:uclubs:${viewer}`] : ["GET", "c:none"],
    ["ZCARD", "c:clubs:new"],
  ]);
  const ids = [...new Set([...((mine as string[]) ?? []), ...((popular as string[]) ?? []), ...((fresh as string[]) ?? [])])].filter(Boolean);
  const all = await cards(await loadClubs(ids), viewer);
  const by = new Map(all.map((c) => [c.id, c]));
  const pick = (list: unknown) => ((list as string[]) ?? []).map((id) => by.get(id)).filter((c): c is ClubCard => !!c);
  return {
    mine: pick(mine).sort((a, b) => b.members - a.members),
    popular: pick(popular),
    fresh: pick(fresh),
    total: Number(total ?? 0),
  };
}

/** A club's page by its slug. */
export async function getClub(slug: string, viewer?: string): Promise<ClubPage | undefined> {
  const club = await clubBySlug(slug);
  if (!club) return undefined;
  const [card] = await cards([club], viewer);
  const admin = card.myRole === "owner" || card.myRole === "admin";
  const inside = club.privacy === "open" || !!card.myRole;
  const res = await pipe([
    inside ? ["HGETALL", `c:clubm:${club.id}`] : ["GET", "c:none"],
    admin ? ["HGETALL", `c:clubreq:${club.id}`] : ["GET", "c:none"],
    inside ? ["ZREVRANGE", `c:clubpk:${club.id}`, 0, MAX_PICKS - 1, "WITHSCORES"] : ["GET", "c:none"],
    ["HGETALL", `c:clubpkby:${club.id}`],
  ]);
  const members = Object.entries(pairs(res[0]))
    .map(([id, v]) => ({ id, ...parseRole(v)! }))
    .filter((m) => m.role)
    .sort((a, b) => ["owner", "admin", "member"].indexOf(a.role) - ["owner", "admin", "member"].indexOf(b.role) || a.since.localeCompare(b.since))
    .slice(0, 300);
  const requests = Object.entries(pairs(res[1])).map(([id, at]) => ({ id, at }));
  // Picks still to come (or still on), most votes first; the taste counts every pick.
  const scored = (res[2] as string[]) ?? [];
  const meta = pairs(res[3]);
  const all = Object.values(meta).map((v) => json<Omit<ClubPick, "votes" | "voted">>(v)).filter((p): p is Omit<ClubPick, "votes" | "voted"> => !!p);
  const upcoming: ClubPick[] = [];
  for (let i = 0; i + 1 < scored.length; i += 2) {
    const p = json<Omit<ClubPick, "votes" | "voted">>(meta[scored[i]]);
    if (p && Date.parse(p.until ?? p.start) > Date.now() - 6 * 3600000) upcoming.push({ ...p, votes: Math.round(Number(scored[i + 1])), voted: false });
  }
  if (viewer && upcoming.length) {
    const voted = await pipe(upcoming.map((p): Cmd => ["SISMEMBER", `c:clubpkv:${club.id}:${p.id}`, viewer]));
    upcoming.forEach((p, i) => (p.voted = Number(voted[i]) === 1));
  }
  const profiles = await getProfiles([...members.map((m) => m.id), ...requests.map((r) => r.id), ...upcoming.map((p) => p.by)]);
  return {
    club: card,
    inside,
    members: members.filter((m) => profiles[m.id]).map((m) => ({ profile: profiles[m.id], role: m.role, since: m.since })),
    requests: requests.filter((r) => profiles[r.id]).map((r) => ({ profile: profiles[r.id], at: r.at })),
    picks: inside ? upcoming : [],
    taste: tasteOf(club, all),
    profiles,
  };
}

/** Shares of what a club is into: each vibe counts as three picks, so a new club has a taste too. */
export function tasteOf(club: Pick<Club, "vibes">, picks: { groupSlug: string }[]): { group: string; share: number }[] {
  const n = new Map<string, number>();
  for (const v of club.vibes) n.set(v, (n.get(v) ?? 0) + 3);
  for (const p of picks) n.set(p.groupSlug, (n.get(p.groupSlug) ?? 0) + 1);
  const total = [...n.values()].reduce((a, b) => a + b, 0);
  return [...n.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([group, k]) => ({ group, share: Math.round((k / total) * 100) }));
}

/** What notices and wall posts show about a club. */
export const clubMeta = (c: Club): TargetMeta => ({ target: wallOf(c.id), title: c.name, href: `/clubs/${c.slug}`, sub: `${c.emoji} Club`, hue: c.hue });

/** Who may read a club's wall, and post on it. */
export async function wallAccess(target: string, viewer?: string): Promise<{ club: Club; read: boolean; post: boolean }> {
  const club = await requireClub(target.slice(2));
  const role = await roleIn(club.id, viewer);
  return { club, read: club.privacy === "open" || !!role, post: !!role };
}

// ---- Founding and editing --------------------------------------------------------------------

function cleanFields(input: Record<string, unknown>, prev?: Club) {
  const name = input.name === undefined && prev ? prev.name : cleanText(input.name, { min: 3, max: 40 }).replace(/\s+/g, " ");
  if (RESERVED.test(name)) throw new CommunityError("Pick another name: that one sounds official.");
  const tagline = input.tagline === undefined && prev ? prev.tagline : cleanText(input.tagline, { min: 3, max: 90 }).replace(/\s+/g, " ");
  const about = input.about === undefined ? prev?.about : String(input.about ?? "").trim() ? cleanText(input.about, { min: 2, max: 600 }) : undefined;
  for (const t of [name, tagline, about ?? ""]) checkSafety(t);
  const emoji = typeof input.emoji === "string" && CLUB_EMOJIS.includes(input.emoji) ? input.emoji : (prev?.emoji ?? CLUB_EMOJIS[0]);
  const hue = Number.isFinite(Number(input.hue)) ? Math.abs(Math.round(Number(input.hue))) % 360 : (prev?.hue ?? 265);
  const vibes = Array.isArray(input.vibes) ? [...new Set(input.vibes.filter((v): v is string => typeof v === "string" && VIBES.has(v)))].slice(0, 5) : (prev?.vibes ?? []);
  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.map((t) => String(t ?? "").toLowerCase().replace(/[^\p{L}\p{N} &'-]/gu, "").replace(/\s+/g, " ").trim()).filter((t) => t.length >= 2 && t.length <= 24))].slice(0, 6)
    : (prev?.tags ?? []);
  for (const t of tags) checkSafety(t);
  const privacy: ClubPrivacy = input.privacy === "request" || input.privacy === "open" ? input.privacy : (prev?.privacy ?? "open");
  const dest = input.cityId === undefined ? undefined : typeof input.cityId === "string" && input.cityId ? getDestination(input.cityId) : null;
  const city = dest === undefined ? { cityId: prev?.cityId, city: prev?.city } : dest ? { cityId: dest.id, city: dest.name } : { cityId: undefined, city: undefined };
  return { name, tagline, about, emoji, hue, vibes, tags, privacy, ...city };
}

/** Founds a club; the founder is its owner. */
export async function createClub(secret: string, input: Record<string, unknown>, ip: string): Promise<Club> {
  const me = await requireProfile(secret);
  const f = cleanFields(input);
  const [owned, joined] = await pipe([["SMEMBERS", `c:uowned:${me.id}`], ["SMEMBERS", `c:uclubs:${me.id}`]]);
  if (((owned as string[]) ?? []).length >= MAX_OWNED) throw new CommunityError(`You can run up to ${MAX_OWNED} clubs. Hand one over or close it first.`);
  if (((joined as string[]) ?? []).length >= MAX_JOINED) throw new CommunityError(`You're in ${MAX_JOINED} clubs already. Leave one first.`);
  // Counted once a club would really be made, so fixing a typo in the form costs nothing.
  await limit(`u:${me.id}:club-new`, 5, 86400);
  await limit(`ip:${ip}:club-new`, 10, 86400);
  const id = randomBytes(8).toString("hex");
  // A unique address: the name, then the name and a number.
  const base = slugify(f.name).slice(0, 40) || "club";
  let slug = "";
  for (let i = 1; i < 30 && !slug; i++) {
    const s = i === 1 ? base : `${base}-${i}`;
    if (s === "new") continue;
    if ((await cmd(["SET", `c:clubslug:${s}`, id, "NX"])) === "OK") slug = s;
  }
  if (!slug) throw new CommunityError("That name is taken. Try another.", 409);
  const club: Club = { id, slug, ...f, owner: me.id, createdAt: now() };
  const t = Date.now();
  await pipe([
    ["SET", `c:club:${id}`, JSON.stringify(club)],
    ["HSET", `c:clubm:${id}`, me.id, `owner|${club.createdAt}`],
    ["SADD", `c:uclubs:${me.id}`, id],
    ["SADD", `c:uowned:${me.id}`, id],
    ["ZADD", "c:clubs:new", t, id],
    ["ZADD", "c:clubs:size", 1, id],
    ["LPUSH", `c:clubface:${id}`, me.id],
    ["HINCRBY", `c:uc:${me.id}`, "founded", 1],
    ["ZINCRBY", "c:karma", 10, me.id],
    ["SET", `c:meta:${wallOf(id)}`, JSON.stringify(clubMeta(club))],
  ]);
  return club;
}

async function requireRole(secret: string, clubId: unknown, roles: ClubRole[]): Promise<{ me: string; club: Club; role: ClubRole }> {
  const me = (await requireProfile(secret)).id;
  const club = await requireClub(clubId);
  const role = await roleIn(club.id, me);
  if (!role || !roles.includes(role)) throw new CommunityError(roles.includes("member") ? "Join the club first." : "Only the club's owner or admins can do that.", 403);
  return { me, club, role };
}

/** Owners and admins edit the club's name, look and description. Its address stays. */
export async function updateClub(secret: string, clubId: unknown, input: Record<string, unknown>): Promise<Club> {
  const { club, me } = await requireRole(secret, clubId, ["owner", "admin"]);
  await limit(`u:${me}:club-edit`, 30, 3600);
  const next: Club = { ...club, ...cleanFields(input, club) };
  await pipe([["SET", `c:club:${club.id}`, JSON.stringify(next)], ["SET", `c:meta:${wallOf(club.id)}`, JSON.stringify(clubMeta(next))]]);
  return next;
}

/** The owner closes the club for good. */
export async function deleteClub(secret: string, clubId: unknown) {
  const { club } = await requireRole(secret, clubId, ["owner"]);
  const members = Object.keys(pairs(await cmd(["HGETALL", `c:clubm:${club.id}`])));
  await pipe([
    ...members.map((m): Cmd => ["SREM", `c:uclubs:${m}`, club.id]),
    ["SREM", `c:uowned:${club.owner}`, club.id],
    ["HINCRBY", `c:uc:${club.owner}`, "founded", -1],
    ["DEL", `c:club:${club.id}`, `c:clubslug:${club.slug}`, `c:clubm:${club.id}`, `c:clubreq:${club.id}`, `c:clubban:${club.id}`, `c:clubface:${club.id}`, `c:clubpk:${club.id}`, `c:clubpkby:${club.id}`],
    ["ZREM", "c:clubs:new", club.id],
    ["ZREM", "c:clubs:size", club.id],
  ]);
}

// ---- Membership ------------------------------------------------------------------------------

async function admins(club: Club): Promise<string[]> {
  const m = pairs(await cmd(["HGETALL", `c:clubm:${club.id}`]));
  return Object.entries(m)
    .filter(([, v]) => ["owner", "admin"].includes(parseRole(v)?.role ?? ""))
    .map(([id]) => id)
    .slice(0, 6);
}

const clubNotice = (club: Club, by: string, text: string): Notice => ({ type: "club", by, post: "", target: wallOf(club.id), at: now(), text });

async function addMember(club: Club, who: string): Promise<number> {
  const [, , , size] = await pipe([
    ["HSET", `c:clubm:${club.id}`, who, `member|${now()}`],
    ["SADD", `c:uclubs:${who}`, club.id],
    ["HDEL", `c:clubreq:${club.id}`, who],
    ["ZINCRBY", "c:clubs:size", 1, club.id],
    ["LPUSH", `c:clubface:${club.id}`, who],
    ["LTRIM", `c:clubface:${club.id}`, 0, 11],
  ]);
  return Math.round(Number(size ?? 0));
}

/** Joins an open club, or asks to join a request-only one. */
export async function joinClub(secret: string, clubId: unknown): Promise<{ status: "joined" | "requested"; members: number }> {
  const me = (await requireProfile(secret)).id;
  const club = await requireClub(clubId);
  await limit(`u:${me}:club-join`, 30, 3600);
  const [role, banned, joined] = await pipe([["HGET", `c:clubm:${club.id}`, me], ["SISMEMBER", `c:clubban:${club.id}`, me], ["SMEMBERS", `c:uclubs:${me}`]]);
  const size = async () => Math.round(Number((await cmd(["ZSCORE", "c:clubs:size", club.id])) ?? 0));
  if (parseRole(role)) return { status: "joined", members: await size() };
  if (Number(banned) === 1) throw new CommunityError("This club's admins have removed you, so you can't join again.", 403);
  if (((joined as string[]) ?? []).length >= MAX_JOINED) throw new CommunityError(`You're in ${MAX_JOINED} clubs already. Leave one first.`);
  if (club.privacy === "request") {
    const fresh = Number(await cmd(["HSET", `c:clubreq:${club.id}`, me, now()])) === 1;
    if (fresh) {
      const cmds: Cmd[] = [];
      for (const a of await admins(club)) cmds.push(...(await notice(a, clubNotice(club, me, "asked to join"))));
      await pipe(cmds);
    }
    return { status: "requested", members: await size() };
  }
  const members = await addMember(club, me);
  // Small clubs: the owner hears about each new member.
  if (members <= 50) await pipe(await notice(club.owner, clubNotice(club, me, "joined")));
  return { status: "joined", members };
}

/** Leaves a club, or withdraws a request. The owner hands the club over (or closes it) first. */
export async function leaveClub(secret: string, clubId: unknown) {
  const me = (await requireProfile(secret)).id;
  const club = await requireClub(clubId);
  const role = await roleIn(club.id, me);
  if (role === "owner") throw new CommunityError("You own this club: make someone else the owner first, or close the club.");
  if (!role) return void (await cmd(["HDEL", `c:clubreq:${club.id}`, me]));
  await pipe([["HDEL", `c:clubm:${club.id}`, me], ["SREM", `c:uclubs:${me}`, club.id], ["ZINCRBY", "c:clubs:size", -1, club.id]]);
}

/** Owners and admins accept or turn down a join request. */
export async function answerRequest(secret: string, clubId: unknown, who: unknown, accept: boolean) {
  const { club, me } = await requireRole(secret, clubId, ["owner", "admin"]);
  const id = String(who ?? "");
  if (!(await cmd(["HGET", `c:clubreq:${club.id}`, id]))) throw new CommunityError("That request is gone.", 404);
  if (!accept) return void (await cmd(["HDEL", `c:clubreq:${club.id}`, id]));
  await addMember(club, id);
  await pipe(await notice(id, clubNotice(club, me, "let you into")));
}

/** Owners and admins remove a member (admins can't remove admins or the owner); `ban` keeps them out. */
export async function removeMember(secret: string, clubId: unknown, who: unknown, ban = false) {
  const { club, role, me } = await requireRole(secret, clubId, ["owner", "admin"]);
  const id = String(who ?? "");
  const theirs = await roleIn(club.id, id);
  if (!theirs) throw new CommunityError("They're not in this club.", 404);
  if (id === me || theirs === "owner" || (role === "admin" && theirs === "admin")) throw new CommunityError("You can't remove this member.", 403);
  await pipe([
    ["HDEL", `c:clubm:${club.id}`, id],
    ["SREM", `c:uclubs:${id}`, club.id],
    ["ZINCRBY", "c:clubs:size", -1, club.id],
    ...(ban ? ([["SADD", `c:clubban:${club.id}`, id]] as Cmd[]) : []),
  ]);
}

/** The owner makes a member an admin, or an admin a member again. */
export async function setClubRole(secret: string, clubId: unknown, who: unknown, role: unknown) {
  const { club, me } = await requireRole(secret, clubId, ["owner"]);
  const id = String(who ?? "");
  const theirs = parseRole(await cmd(["HGET", `c:clubm:${club.id}`, id]));
  if (!theirs || id === me) throw new CommunityError("They're not a member you can change.", 404);
  const next: ClubRole = role === "admin" ? "admin" : "member";
  await cmd(["HSET", `c:clubm:${club.id}`, id, `${next}|${theirs.since}`]);
  if (next === "admin" && theirs.role !== "admin") await pipe(await notice(id, clubNotice(club, me, "made you an admin of")));
}

/** The owner hands the club over to another member, and stays on as an admin. */
export async function transferClub(secret: string, clubId: unknown, who: unknown) {
  const { club, me } = await requireRole(secret, clubId, ["owner"]);
  const id = String(who ?? "");
  const theirs = parseRole(await cmd(["HGET", `c:clubm:${club.id}`, id]));
  if (!theirs || id === me) throw new CommunityError("Pick a member of the club.", 404);
  const mine = parseRole(await cmd(["HGET", `c:clubm:${club.id}`, me]))!;
  const owned = ((await cmd<string[]>(["SMEMBERS", `c:uowned:${id}`])) ?? []).length;
  if (owned >= MAX_OWNED) throw new CommunityError(`They already run ${MAX_OWNED} clubs.`);
  await pipe([
    ["HSET", `c:clubm:${club.id}`, id, `owner|${theirs.since}`],
    ["HSET", `c:clubm:${club.id}`, me, `admin|${mine.since}`],
    ["SET", `c:club:${club.id}`, JSON.stringify({ ...club, owner: id })],
    ["SREM", `c:uowned:${me}`, club.id],
    ["SADD", `c:uowned:${id}`, club.id],
    ...(await notice(id, clubNotice(club, me, "handed you"))),
  ]);
}

/** Owners and admins take a post off the club's wall. */
export async function moderateWall(secret: string, clubId: unknown, postId: unknown) {
  const { club } = await requireRole(secret, clubId, ["owner", "admin"]);
  await removeWallPost(wallOf(club.id), String(postId ?? ""));
}

// ---- Picks -----------------------------------------------------------------------------------

/** A member shares an upcoming event with the club (and votes for it). */
export async function addPick(secret: string, clubId: unknown, card: EventCard | undefined): Promise<ClubPick> {
  const { club, me } = await requireRole(secret, clubId, ["owner", "admin", "member"]);
  if (!card || card.online || Date.parse(card.until ?? card.start) < Date.now() - 6 * 3600000) throw new CommunityError("Pick an event that's still to come.");
  await limit(`u:${me}:club-pick`, 30, 3600);
  const n = Number((await cmd(["ZCARD", `c:clubpk:${club.id}`])) ?? 0);
  if (n >= MAX_PICKS) throw new CommunityError("This club has shared a lot of events: remove some past ones first.");
  const pick: Omit<ClubPick, "votes" | "voted"> = {
    id: card.id, slug: card.slug, title: card.title, start: card.start, until: card.until, timeZone: card.timeZone, venueName: card.venueName, city: card.city,
    imageUrl: card.imageUrl, hue: card.posterHue, categorySlug: card.categorySlug, groupSlug: card.groupSlug, by: me, at: now(),
  };
  const added = Number(await cmd(["HSETNX", `c:clubpkby:${club.id}`, card.id, JSON.stringify(pick)])) === 1;
  const prev = added ? pick : (json<Omit<ClubPick, "votes" | "voted">>(await cmd(["HGET", `c:clubpkby:${club.id}`, card.id])) ?? pick);
  const [, votes] = await pipe([["SADD", `c:clubpkv:${club.id}:${card.id}`, me], ["SCARD", `c:clubpkv:${club.id}:${card.id}`]]);
  await cmd(["ZADD", `c:clubpk:${club.id}`, Number(votes), card.id]);
  if (added) await cmd(["ZINCRBY", "c:karma", 1, me]);
  return { ...prev, votes: Number(votes), voted: true };
}

/** "I'd go": a member's vote for a shared event, on or off. */
export async function votePick(secret: string, clubId: unknown, eventId: unknown): Promise<{ votes: number; voted: boolean }> {
  const { club, me } = await requireRole(secret, clubId, ["owner", "admin", "member"]);
  const id = String(eventId ?? "");
  if (!(await cmd(["HGET", `c:clubpkby:${club.id}`, id]))) throw new CommunityError("That event isn't shared with this club.", 404);
  await limit(`u:${me}:club-vote`, 200, 3600);
  const key = `c:clubpkv:${club.id}:${id}`;
  const on = Number(await cmd(["SADD", key, me])) === 1;
  if (!on) await cmd(["SREM", key, me]);
  const votes = Number((await cmd(["SCARD", key])) ?? 0);
  await cmd(["ZADD", `c:clubpk:${club.id}`, votes, id]);
  return { votes, voted: on };
}

/** The member who shared an event, or an owner or admin, takes it off the list. */
export async function removePick(secret: string, clubId: unknown, eventId: unknown) {
  const { club, me, role } = await requireRole(secret, clubId, ["owner", "admin", "member"]);
  const id = String(eventId ?? "");
  const pick = json<ClubPick>(await cmd(["HGET", `c:clubpkby:${club.id}`, id]));
  if (!pick) return;
  if (pick.by !== me && role === "member") throw new CommunityError("Only who shared it, or an admin, can remove it.", 403);
  await pipe([["HDEL", `c:clubpkby:${club.id}`, id], ["ZREM", `c:clubpk:${club.id}`, id], ["DEL", `c:clubpkv:${club.id}:${id}`]]);
}

/** The clubs a member is in, for "share with a club" menus. */
export async function myClubs(secret: string): Promise<ClubCard[]> {
  const me = await memberOf(secret);
  if (!me) return [];
  const ids = (await cmd<string[]>(["SMEMBERS", `c:uclubs:${me}`])) ?? [];
  return cards(await loadClubs(ids), me);
}
