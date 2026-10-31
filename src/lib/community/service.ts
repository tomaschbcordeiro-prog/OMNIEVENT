import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { cmd, pairs, persistent, pipe, type Cmd } from "./kv";
import { safetyProblem } from "./safety";
import {
  AVATARS,
  BADGES,
  POST_KINDS,
  TARGET_RE,
  type CommunityHome,
  type Notice,
  type Notices,
  type FeedItem,
  type Post,
  type PostKind,
  type Profile,
  type PublicProfile,
  type Summary,
  type TargetMeta,
  type Thread,
  type AccountInfo,
  type FollowingFeed,
  type ThreadHead,
  REACTIONS,
  REPORT_REASONS,
  USERNAME_RE,
} from "./types";

/**
 * Community: profiles, posts (chat, questions, tips, meet-ups, reviews), likes, ratings and
 * "going / interested" plans, attached to events, venues, performers/teams and cities.
 *
 * - Accounts: first and last name, a unique username, an email and a password (scrypt).
 *   The browser keeps a random secret; signing in links it to the account (a session), so
 *   the same account works on any device. Profiles made before accounts existed (keyed by
 *   the secret's hash) keep working for reading and are completed into an account.
 * - Posts are plain text and rate-limited. Contact details, ticket selling, repeated posts and
 *   (on a member's first day) links are refused; posts are hidden after three reports.
 * - Members can block each other: a blocked member's posts disappear for the blocker, and
 *   they can't reply to, react to, mention, follow or join the blocker's meet-ups.
 * - Reactions (❤️ is the classic like), @mentions and "I'm in" on meet-ups notify people.
 * - Keys are prefixed `c:`; see each function for what it reads and writes.
 */

export class CommunityError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const memberId = (secret: string) => createHash("sha256").update(`omni:${secret}`).digest("hex").slice(0, 16);

const now = () => new Date().toISOString();
const week = (t = Date.now()) => Math.floor(t / (7 * 86400000));
const json = <T,>(v: unknown): T | undefined => {
  if (typeof v !== "string") return undefined;
  try {
    return JSON.parse(v) as T;
  } catch {
    return undefined;
  }
};

export function checkTarget(target: string) {
  if (!TARGET_RE.test(target)) throw new CommunityError("Unknown place or event.");
}

// ---- Text rules ------------------------------------------------------------------------

const MAX_TEXT = 1200;

export function cleanText(raw: unknown, { min = 2, max = MAX_TEXT } = {}): string {
  const text = String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < min) throw new CommunityError("Write a little more.");
  if (text.length > max) throw new CommunityError(`Keep it under ${max} characters.`);
  if ((text.match(/https?:\/\//g) ?? []).length > 2) throw new CommunityError("Too many links in one post.");
  return text;
}

// ---- Safety --------------------------------------------------------------------------------

/** Throws with the reason when a text breaks the safety rules (see ./safety). */
export function checkSafety(text: string) {
  const why = safetyProblem(text);
  if (why) throw new CommunityError(why);
}
export { hasPhone } from "./safety";

const LINK_RE = /https?:\/\/|www\./i;
const textKey = (t: string) => createHash("sha256").update(t.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);

// ---- Rate limits -----------------------------------------------------------------------

async function limit(key: string, max: number, windowSec: number) {
  const bucket = `c:rl:${key}:${Math.floor(Date.now() / (windowSec * 1000))}`;
  const [n] = await pipe([["INCR", bucket], ["EXPIRE", bucket, windowSec]]);
  if (Number(n) > max) throw new CommunityError("You're going a bit fast. Try again in a few minutes.", 429);
}

// ---- Profiles --------------------------------------------------------------------------

function badgesFor(c: PublicProfile["counts"], karma: number): string[] {
  const out = ["newcomer"];
  if (c.posts >= 1) out.push("voice");
  if (c.reviews >= 5) out.push("critic");
  if (c.likes >= 10) out.push("helper");
  if (c.going >= 5) out.push("regular");
  if (c.posts >= 25) out.push("storyteller");
  if (karma >= 250) out.push("legend");
  return out.filter((b) => b in BADGES);
}

export async function getProfiles(ids: string[]): Promise<Record<string, PublicProfile>> {
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return {};
  const res = await pipe(uniq.flatMap((id): Cmd[] => [["GET", `c:u:${id}`], ["HGETALL", `c:uc:${id}`], ["ZSCORE", "c:karma", id]]));
  const out: Record<string, PublicProfile> = {};
  uniq.forEach((id, i) => {
    const p = json<Profile>(res[i * 3]);
    if (!p) return;
    const c = pairs(res[i * 3 + 1]);
    const counts = { posts: Number(c.posts ?? 0), reviews: Number(c.reviews ?? 0), likes: Number(c.likes ?? 0), going: Number(c.going ?? 0) };
    const karma = Math.round(Number(res[i * 3 + 2] ?? 0));
    out[id] = { ...p, karma, counts, badges: badgesFor(counts, karma) };
  });
  return out;
}

export async function getProfile(id: string): Promise<PublicProfile | undefined> {
  return (await getProfiles([id]))[id];
}

/** Edits the signed-in member's profile and account details. */
export async function saveProfile(secret: string, input: Record<string, unknown>, ip: string): Promise<PublicProfile> {
  const prev = await requireProfile(secret);
  const id = prev.id;
  await limit(`ip:${ip}:profile`, 30, 3600);
  const account = await getAccount(id);
  if (!account) throw new CommunityError("Finish creating your account first.", 401);
  const firstName = input.firstName === undefined ? account.firstName : personName(input.firstName, "First name");
  const lastName = input.lastName === undefined ? account.lastName : personName(input.lastName, "Last name");
  const username = input.username === undefined ? account.username : cleanUsername(input.username);
  const email = input.email === undefined ? account.email : cleanEmail(input.email);
  const cmds: Cmd[] = [];
  if (username !== account.username) {
    if (!(await claim(`c:uname:${username}`, id))) throw new CommunityError("That username is taken. Try another.", 409);
    cmds.push(["DEL", `c:uname:${account.username}`]);
  }
  if (email !== account.email) {
    if (!(await claim(`c:email:${email}`, id))) {
      if (username !== account.username) await cmd(["DEL", `c:uname:${username}`]);
      throw new CommunityError("There's already an account with that email.", 409);
    }
    cmds.push(["DEL", `c:email:${account.email}`]);
  }
  const avatar = typeof input.avatar === "string" && AVATARS.includes(input.avatar) ? input.avatar : prev.avatar;
  const hue = Number.isFinite(Number(input.hue)) ? Math.abs(Math.round(Number(input.hue))) % 360 : prev.hue;
  const bio = input.bio === undefined ? prev.bio : String(input.bio).trim() ? cleanText(input.bio, { min: 1, max: 160 }) : undefined;
  const profile: Profile = { ...prev, name: `${firstName} ${lastName}`, firstName, lastName, username, avatar, hue, bio };
  cmds.push(["SET", `c:u:${id}`, JSON.stringify(profile)], ["SET", `c:acct:${id}`, JSON.stringify({ ...account, firstName, lastName, username, email })]);
  await pipe(cmds);
  return (await getProfile(id))!;
}

async function requireProfile(secret: string): Promise<Profile> {
  const id = await memberOf(secret);
  const p = id ? json<Profile>(await cmd(["GET", `c:u:${id}`])) : undefined;
  if (!p) throw new CommunityError("Create an account or sign in first.", 401);
  if (!p.username) throw new CommunityError("Finish creating your account first.", 401);
  return p;
}

// ---- Accounts --------------------------------------------------------------------------

interface Account extends AccountInfo {
  id: string;
  /** scrypt: "s1$salt$hash", base64. */
  pw: string;
  createdAt: string;
}

const SESSION_TTL = 400 * 86400;
const sessionKey = (secret: string) => `c:sess:${memberId(secret)}`;
/** Every signed-in browser of an account, so they can all be signed out at once. */
const sessionsOf = (id: string) => `c:ss:${id}`;
const openSession = (secret: string, id: string): Cmd[] => [
  ["SET", sessionKey(secret), id, "EX", SESSION_TTL],
  ["SADD", sessionsOf(id), sessionKey(secret)],
  ["EXPIRE", sessionsOf(id), SESSION_TTL],
];
/** Ends the account's sessions, except `keep`'s; returns how many ended. */
async function endSessions(id: string, keep?: string): Promise<number> {
  const all = (((await cmd<string[]>(["SMEMBERS", sessionsOf(id)])) ?? []) as string[]).filter((k) => k !== keep);
  await pipe([...(all.length ? ([["DEL", ...all]] as Cmd[]) : []), ["DEL", sessionsOf(id)], ...(keep ? ([["SADD", sessionsOf(id), keep], ["EXPIRE", sessionsOf(id), SESSION_TTL]] as Cmd[]) : [])]);
  return all.length;
}
const RESERVED = new Set(["admin", "administrator", "omnievent", "support", "help", "staff", "moderator", "mod", "root", "system", "null", "undefined", "me", "community", "official", "team"]);

/** Who a browser secret is: the account it is signed in to, else its pre-account profile. */
export async function memberOf(secret: unknown): Promise<string | undefined> {
  if (typeof secret !== "string" || secret.length < 20) return undefined;
  const session = await cmd(["GET", sessionKey(secret)]);
  return typeof session === "string" ? session : memberId(secret);
}

function personName(raw: unknown, what: string): string {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 30) throw new CommunityError(`${what}: 1 to 30 characters.`);
  if (!/^[\p{L}\p{M} .'-]+$/u.test(name)) throw new CommunityError(`${what}: use letters, spaces, dots, dashes or apostrophes.`);
  return name;
}

export function cleanUsername(raw: unknown): string {
  const u = String(raw ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!USERNAME_RE.test(u)) throw new CommunityError("Usernames are 3 to 20 characters: letters, numbers, dots and underscores, starting and ending with a letter or number.");
  if (RESERVED.has(u)) throw new CommunityError("That username is reserved. Try another.");
  return u;
}

export function cleanEmail(raw: unknown): string {
  const e = String(raw ?? "").trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new CommunityError("That doesn't look like an email address.");
  return e;
}

// The passwords tried first in every attack, and what people pick for sites like this one.
const COMMON = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "12345678", "123456789", "1234567890", "12341234", "87654321",
  "11111111", "00000000", "qwertyui", "qwertyuiop", "qwerty123", "qwerty12", "1q2w3e4r", "1qaz2wsx", "abc12345", "abcd1234",
  "iloveyou", "letmein1", "welcome1", "football", "sunshine", "princess", "admin123", "aaaaaaaa", "senha123", "contraseña",
  "benfica1", "sporting", "fcporto1", "portugal", "lisboa123", "omnievent", "concerto", "festival", "tickets1", "bilhetes",
]);

function checkPassword(raw: unknown, who?: { username?: string; email?: string }): string {
  const pw = String(raw ?? "");
  if (pw.length < 8) throw new CommunityError("Use at least 8 characters for the password.");
  if (pw.length > 128) throw new CommunityError("That password is too long.");
  const low = pw.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(pw) || /^(?:0?123456789|abcdefgh)/.test(low))
    throw new CommunityError("That password is too easy to guess. Try a few words together, like a short sentence.");
  const local = who?.email?.split("@")[0];
  if ((who?.username && who.username.length >= 4 && low.includes(who.username)) || (local && local.length >= 4 && low.includes(local)))
    throw new CommunityError("Don't use your username or email in the password.");
  return pw.normalize("NFKC");
}

const derive = (pw: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key))));

async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `s1$${salt.toString("base64")}$${(await derive(pw, salt)).toString("base64")}`;
}

async function passwordMatches(pw: string, stored: string): Promise<boolean> {
  const [v, salt, hash] = stored.split("$");
  if (v !== "s1" || !salt || !hash) return false;
  const got = await derive(pw, Buffer.from(salt, "base64"));
  const want = Buffer.from(hash, "base64");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Claims a unique key (username or email) for an account; false if someone else has it. */
async function claim(key: string, id: string): Promise<boolean> {
  const [set, owner] = await pipe([["SET", key, id, "NX"], ["GET", key]]);
  return set === "OK" || owner === id;
}

async function getAccount(id: string): Promise<Account | undefined> {
  return json<Account>(await cmd(["GET", `c:acct:${id}`]));
}

export async function accountInfo(id: string): Promise<AccountInfo | undefined> {
  const a = await getAccount(id);
  return a ? { email: a.email, username: a.username, firstName: a.firstName, lastName: a.lastName } : undefined;
}

/**
 * Creates an account and signs this browser in. A profile this browser made before accounts
 * existed becomes the account's, with its posts and points.
 */
export async function signUp(secret: string, input: Record<string, unknown>, ip: string): Promise<PublicProfile> {
  if (typeof secret !== "string" || secret.length < 20) throw new CommunityError("Missing browser key. Reload the page and try again.", 401);
  await limit(`ip:${ip}:signup`, 8, 3600);
  const firstName = personName(input.firstName, "First name");
  const lastName = personName(input.lastName, "Last name");
  const username = cleanUsername(input.username);
  const email = cleanEmail(input.email);
  const password = checkPassword(input.password, { username, email });
  const current = await memberOf(secret);
  const prev = current ? json<Profile>(await cmd(["GET", `c:u:${current}`])) : undefined;
  if (prev?.username) throw new CommunityError("You're already signed in. Sign out first to create another account.", 409);
  const id = prev ? prev.id : randomBytes(8).toString("hex");

  if (!(await claim(`c:uname:${username}`, id))) throw new CommunityError("That username is taken. Try another.", 409);
  if (!(await claim(`c:email:${email}`, id))) {
    await cmd(["DEL", `c:uname:${username}`]);
    throw new CommunityError("There's already an account with that email. Sign in instead.", 409);
  }
  const account: Account = { id, firstName, lastName, username, email, pw: await hashPassword(password), createdAt: now() };
  const avatar = typeof input.avatar === "string" && AVATARS.includes(input.avatar) ? input.avatar : prev?.avatar ?? AVATARS[0];
  const hue = Number.isFinite(Number(input.hue)) ? Math.abs(Math.round(Number(input.hue))) % 360 : prev?.hue ?? 210;
  const bio = typeof input.bio === "string" && input.bio.trim() ? cleanText(input.bio, { min: 1, max: 160 }) : prev?.bio;
  const profile: Profile = { id, name: `${firstName} ${lastName}`, firstName, lastName, username, avatar, hue, bio, createdAt: prev?.createdAt ?? now() };
  const cmds: Cmd[] = [
    ["SET", `c:acct:${id}`, JSON.stringify(account)],
    ["SET", `c:u:${id}`, JSON.stringify(profile)],
    ...openSession(secret, id),
  ];
  if (!prev) cmds.push(["HINCRBY", "c:stat", "members", 1], ["ZADD", "c:karma", 1, id]);
  await pipe(cmds);
  return (await getProfile(id))!;
}

/** Signs this browser in with an email or username and the password. */
export async function signIn(secret: string, input: Record<string, unknown>, ip: string): Promise<PublicProfile> {
  if (typeof secret !== "string" || secret.length < 20) throw new CommunityError("Missing browser key. Reload the page and try again.", 401);
  await limit(`ip:${ip}:signin`, 20, 900);
  const login = String(input.login ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!login) throw new CommunityError("Enter your email or username.");
  const id = await cmd(["GET", login.includes("@") ? `c:email:${login}` : `c:uname:${login}`]);
  await limit(`acct:${typeof id === "string" ? id : login}:signin`, 10, 900);
  const account = typeof id === "string" ? await getAccount(id) : undefined;
  const pw = String(input.password ?? "").normalize("NFKC");
  // An unknown login takes as long to refuse as a wrong password, so timing doesn't reveal who has an account.
  if (!account) await derive(pw, DUMMY_SALT);
  if (!account || !(await passwordMatches(pw, account.pw))) throw new CommunityError("Wrong email, username or password.", 401);
  await pipe(openSession(secret, account.id));
  return (await getProfile(account.id))!;
}
const DUMMY_SALT = randomBytes(16);

export async function signOut(secret: string) {
  if (typeof secret !== "string" || secret.length < 20) return;
  const id = await cmd(["GET", sessionKey(secret)]);
  await pipe([["DEL", sessionKey(secret)], ...(typeof id === "string" ? ([["SREM", sessionsOf(id), sessionKey(secret)]] as Cmd[]) : [])]);
}

/** Signs the account out on every device, this one included. */
export async function signOutEverywhere(secret: string): Promise<number> {
  const me = await requireProfile(secret);
  const ended = await endSessions(me.id);
  await cmd(["DEL", sessionKey(secret)]);
  return ended;
}

export async function changePassword(secret: string, input: Record<string, unknown>, ip: string) {
  const me = await requireProfile(secret);
  await limit(`acct:${me.id}:signin`, 10, 900);
  const account = await getAccount(me.id);
  if (!account || !(await passwordMatches(String(input.current ?? "").normalize("NFKC"), account.pw))) throw new CommunityError("Your current password isn't right.", 401);
  account.pw = await hashPassword(checkPassword(input.next, { username: account.username, email: account.email }));
  await cmd(["SET", `c:acct:${me.id}`, JSON.stringify(account)]);
  // A new password signs out every other device: whoever knew the old one is out.
  await endSessions(me.id, sessionKey(secret));
  void ip;
}

/**
 * Deletes the account: name, username, email, password, profile, points and plans. Posts
 * stay in their conversations, shown as from a former member.
 */
export async function deleteAccount(secret: string, input: Record<string, unknown>) {
  const me = await requireProfile(secret);
  await limit(`acct:${me.id}:signin`, 10, 900);
  const account = await getAccount(me.id);
  if (!account || !(await passwordMatches(String(input.password ?? "").normalize("NFKC"), account.pw))) throw new CommunityError("That password isn't right.", 401);
  await endSessions(me.id);
  const [plansRaw, follows, followers] = await pipe([["ZRANGE", `c:ugo:${me.id}`, 0, -1], ["SMEMBERS", `c:fol:${me.id}`], ["SMEMBERS", `c:fby:${me.id}`]]);
  const plans = ((plansRaw as string[]) ?? []).filter(Boolean);
  await pipe([
    ...plans.flatMap((t): Cmd[] => [["SREM", `c:go:${t}`, me.id], ["HINCRBY", `c:sum:${t}`, "going", -1]]),
    ...((follows as string[]) ?? []).map((x): Cmd => ["SREM", `c:fby:${x}`, me.id]),
    ...((followers as string[]) ?? []).map((x): Cmd => ["SREM", `c:fol:${x}`, me.id]),
    ["DEL", `c:fol:${me.id}`, `c:fby:${me.id}`, `c:n:${me.id}`, `c:nu:${me.id}`, `c:blk:${me.id}`, `c:urx:${me.id}`, `c:liked:${me.id}`],
    ["DEL", `c:acct:${me.id}`, `c:u:${me.id}`, `c:uc:${me.id}`, `c:up:${me.id}`, `c:ugo:${me.id}`, `c:uname:${account.username}`, `c:email:${account.email}`, sessionKey(secret)],
    ["ZREM", "c:karma", me.id],
    ["HINCRBY", "c:stat", "members", -1],
  ]);
}

/** Usernames resolve to member ids, for profile links like /community/u/maria. */
export async function idForUsername(raw: string): Promise<string | undefined> {
  const u = raw.trim().replace(/^@/, "").toLowerCase();
  if (!USERNAME_RE.test(u)) return undefined;
  const id = await cmd(["GET", `c:uname:${u}`]);
  return typeof id === "string" ? id : undefined;
}

// ---- Targets ---------------------------------------------------------------------------

async function rememberMeta(meta: TargetMeta | undefined) {
  if (meta) await cmd(["SET", `c:meta:${meta.target}`, JSON.stringify(meta)]);
}

async function metas(targets: string[]): Promise<Record<string, TargetMeta>> {
  if (!targets.length) return {};
  const res = (await cmd<unknown[]>(["MGET", ...targets.map((t) => `c:meta:${t}`)])) ?? [];
  const out: Record<string, TargetMeta> = {};
  targets.forEach((t, i) => {
    const m = json<TargetMeta>(res[i]);
    if (m) out[t] = m;
  });
  return out;
}

function toSummary(h: Record<string, string>): Summary {
  const rcount = Number(h.rcount ?? 0);
  return {
    going: Math.max(0, Number(h.going ?? 0)),
    interested: Math.max(0, Number(h.interested ?? 0)),
    posts: Math.max(0, Number(h.posts ?? 0)),
    ratingCount: rcount,
    ratingAvg: rcount ? Math.round((Number(h.rsum ?? 0) / rcount) * 10) / 10 : 0,
  };
}

export async function summaries(targets: string[]): Promise<Record<string, Summary>> {
  const list = [...new Set(targets)].filter((t) => TARGET_RE.test(t)).slice(0, 100);
  const res = await pipe(list.map((t): Cmd => ["HGETALL", `c:sum:${t}`]));
  return Object.fromEntries(list.map((t, i) => [t, toSummary(pairs(res[i]))]));
}

const hot = (target: string, by: number): Cmd => ["ZINCRBY", `c:hot:${week()}`, by, target];

// ---- Threads ---------------------------------------------------------------------------

function tree(posts: Post[]): Post[] {
  const byId = new Map(posts.map((p) => [p.id, { ...p, replies: [] as Post[] }]));
  const top: Post[] = [];
  for (const p of byId.values()) {
    const parent = p.parent ? byId.get(p.parent) : undefined;
    if (parent) parent.replies!.push(p);
    else if (!p.parent) top.push(p);
  }
  for (const p of byId.values()) p.replies!.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return top
    .filter((p) => !p.deleted || p.replies!.length).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function loadPosts(ids: string[], viewer?: string): Promise<Post[]> {
  if (!ids.length) return [];
  const raw = (await cmd<unknown[]>(["MGET", ...ids.map((id) => `c:p:${id}`)])) ?? [];
  const hiddenFor = await blockedBy(viewer);
  const posts = raw.map((r) => json<Post>(r)).filter((p): p is Post => !!p && !p.hidden && !hiddenFor.has(p.author));
  if (!posts.length) return [];
  const targets = [...new Set(posts.map((p) => p.target))];
  const meetups = posts.filter((p) => p.kind === "meetup" && !p.parent && !p.deleted);
  const pid = posts.map((p) => p.id);
  const res = await pipe([
    ...targets.flatMap((t): Cmd[] => [["HGETALL", `c:lk:${t}`], ["HGETALL", `c:rx:${t}`]]),
    ...(viewer ? ([["SMISMEMBER", `c:liked:${viewer}`, ...pid], ["HMGET", `c:urx:${viewer}`, ...pid]] as Cmd[]) : []),
    ...meetups.flatMap((p): Cmd[] => [["SCARD", `c:mj:${p.id}`], ["SRANDMEMBER", `c:mj:${p.id}`, 5], ["SISMEMBER", `c:mj:${p.id}`, viewer ?? "-"]]),
  ]);
  const likes: Record<string, string> = Object.assign({}, ...targets.map((_, i) => pairs(res[i * 2])));
  const rx: Record<string, string> = Object.assign({}, ...targets.map((_, i) => pairs(res[i * 2 + 1])));
  let k = targets.length * 2;
  const liked = viewer ? ((res[k++] as number[]) ?? []) : [];
  const other = viewer ? ((res[k++] as (string | null)[]) ?? []) : [];
  const joins = new Map<string, { n: number; who: string[]; me: boolean }>();
  for (const p of meetups) {
    joins.set(p.id, { n: Number(res[k] ?? 0), who: ((res[k + 1] as string[]) ?? []).filter((id) => !hiddenFor.has(id)), me: Number(res[k + 2]) === 1 });
    k += 3;
  }
  return posts.map((p, i) => {
    const reactions: Record<string, number> = {};
    const hearts = Math.max(0, Number(likes[p.id] ?? 0));
    if (hearts) reactions["❤️"] = hearts;
    for (const e of REACTIONS) {
      const n = Math.max(0, Number(rx[`${p.id}|${e}`] ?? 0));
      if (n && e !== "❤️") reactions[e] = n;
    }
    const mine = liked[i] ? "❤️" : (other[i] ?? undefined) || undefined;
    const j = joins.get(p.id);
    return { ...p, likes: hearts, liked: !!liked[i], reactions, myReaction: mine, ...(j ? { joins: j.n, joiners: j.who, joined: j.me } : {}) };
  });
}

export async function getThread(target: string, viewer?: string, meta?: TargetMeta): Promise<Thread> {
  checkTarget(target);
  const res = await pipe([
    ["ZREVRANGE", `c:t:${target}`, 0, 299],
    ["HGETALL", `c:sum:${target}`],
    ["HGETALL", `c:r:${target}`],
    ["SRANDMEMBER", `c:go:${target}`, 12],
    ...(viewer ? ([["SISMEMBER", `c:go:${target}`, viewer], ["SISMEMBER", `c:in:${target}`, viewer]] as Cmd[]) : []),
  ]);
  const posts = await loadPosts((res[0] as string[]) ?? [], viewer);
  const ratings = pairs(res[2]);
  const dist = [0, 0, 0, 0, 0];
  for (const v of Object.values(ratings)) if (Number(v) >= 1 && Number(v) <= 5) dist[Number(v) - 1]++;
  const hiddenFor = await blockedBy(viewer);
  const goingPeople = ((res[3] as string[]) ?? []).filter((id) => id && !hiddenFor.has(id));
  const profiles = await getProfiles([...posts.map((p) => p.author), ...posts.flatMap((p) => p.joiners ?? []), ...goingPeople]);
  // Keep the shared summary of where this lives up to date for feeds and trending lists.
  if (meta) void rememberMeta(meta).catch(() => {});
  return {
    target,
    summary: toSummary(pairs(res[1])),
    ratingDist: dist,
    me: viewer ? { going: !!res[4], interested: !!res[5], rating: ratings[viewer] ? Number(ratings[viewer]) : undefined } : undefined,
    goingPeople: goingPeople.filter((id) => profiles[id]),
    posts: tree(posts),
    profiles,
    persistent,
  };
}

/** The newest post and the post count: cheap enough to check every half minute. */
export async function threadHead(target: string): Promise<ThreadHead> {
  checkTarget(target);
  const [latest, posts] = await pipe([["ZREVRANGE", `c:t:${target}`, 0, 0], ["HGET", `c:sum:${target}`, "posts"]]);
  return { posts: Math.max(0, Number(posts ?? 0)), latest: ((latest as string[]) ?? [])[0] ?? null };
}

/** The same for the community-wide feed. */
export async function feedHead(): Promise<ThreadHead> {
  const [latest, posts] = await pipe([["ZREVRANGE", "c:feed", 0, 0], ["HGET", "c:stat", "posts"]]);
  return { posts: Math.max(0, Number(posts ?? 0)), latest: ((latest as string[]) ?? [])[0] ?? null };
}

const MENTION_RE = /(^|[^\w@.])@([a-z0-9][a-z0-9._]{1,18}[a-z0-9])(?![\w.])/gi;
/** Usernames mentioned in a text (up to five). */
export function mentionsIn(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION_RE)].map((m) => m[2].toLowerCase()))].slice(0, 5);
}

export async function createPost(
  secret: string,
  input: { target: string; kind?: unknown; text?: unknown; rating?: unknown; parent?: unknown },
  meta: TargetMeta | undefined,
  ip: string,
): Promise<Post> {
  const me = await requireProfile(secret);
  checkTarget(input.target);
  await limit(`u:${me.id}:post`, 8, 600);
  await limit(`ip:${ip}:post`, 40, 3600);
  const kind: PostKind = POST_KINDS.includes(input.kind as PostKind) ? (input.kind as PostKind) : "comment";
  const rating = kind === "review" ? Math.round(Number(input.rating)) : undefined;
  if (kind === "review" && !(rating! >= 1 && rating! <= 5)) throw new CommunityError("Pick 1 to 5 stars.");
  let parent: string | undefined;
  let replyTo: Post | undefined;
  if (input.parent) {
    const p = json<Post>(await cmd(["GET", `c:p:${String(input.parent)}`]));
    if (!p || p.target !== input.target || p.hidden) throw new CommunityError("That conversation is gone.");
    if (p.author !== me.id && (await blocks(p.author, me.id))) throw new CommunityError("You can't reply to this member.", 403);
    parent = p.parent ?? p.id; // one level of replies
    replyTo = p;
  }
  const text = cleanText(input.text, { min: kind === "review" ? 0 : 2 });
  checkSafety(text);
  // A member's first day: no links (the usual spam pattern).
  if (LINK_RE.test(text) && Date.now() - Date.parse(me.createdAt) < 86400000) throw new CommunityError("New members can share links after their first day. Describe it in words for now.");
  // The same words twice in a day are almost always a mistake or spam.
  const dupKey = `c:dup:${me.id}`;
  const dup = textKey(text);
  if (text && Number(await cmd(["SISMEMBER", dupKey, dup])) === 1) throw new CommunityError("You've already posted that today.");
  const post: Post = { id: randomBytes(8).toString("hex"), target: input.target, author: me.id, kind: parent ? "comment" : kind, text, rating: parent ? undefined : rating, parent, createdAt: now() };
  const t = Date.now();
  const cmds: Cmd[] = [
    ["SET", `c:p:${post.id}`, JSON.stringify(post)],
    ["ZADD", `c:t:${post.target}`, t, post.id],
    ["ZADD", `c:up:${me.id}`, t, post.id],
    ["ZADD", "c:feed", t, post.id],
    ["ZREMRANGEBYRANK", "c:feed", 0, -401],
    ["HINCRBY", `c:sum:${post.target}`, "posts", 1],
    ["HINCRBY", `c:uc:${me.id}`, "posts", 1],
    ["HINCRBY", "c:stat", "posts", 1],
    ["ZINCRBY", "c:karma", kind === "review" ? 10 : 5, me.id],
    hot(post.target, 2),
    ...(text ? ([["SADD", dupKey, dup], ["EXPIRE", dupKey, 86400]] as Cmd[]) : []),
  ];
  const told = new Set<string>([me.id]);
  if (replyTo) {
    const n: Notice = { type: "reply", by: me.id, post: post.id, target: post.target, at: post.createdAt, text: text.slice(0, 120) };
    cmds.push(...(await notice(replyTo.author, n)));
    told.add(replyTo.author);
    // The author of the conversation hears about replies to other replies in it too.
    if (replyTo.parent) {
      const top = json<Post>(await cmd(["GET", `c:p:${replyTo.parent}`]));
      if (top && !told.has(top.author)) {
        cmds.push(...(await notice(top.author, n)));
        told.add(top.author);
      }
    }
  }
  // @mentions: each member named hears about it once.
  const names = mentionsIn(text);
  if (names.length) {
    const found = (await cmd<(string | null)[]>(["MGET", ...names.map((u) => `c:uname:${u}`)])) ?? [];
    for (const id of found) {
      if (typeof id !== "string" || told.has(id)) continue;
      told.add(id);
      cmds.push(...(await notice(id, { type: "mention", by: me.id, post: post.id, target: post.target, at: post.createdAt, text: text.slice(0, 120) })));
    }
  }
  await pipe(cmds);
  if (post.rating) await rate(me.id, post.target, post.rating);
  await rememberMeta(meta);
  return { ...post, likes: 0, liked: false, replies: [] };
}

async function rate(uid: string, target: string, stars: number) {
  const prev = Number((await cmd(["HGET", `c:r:${target}`, uid])) ?? 0);
  const cmds: Cmd[] = [["HSET", `c:r:${target}`, uid, stars], ["HINCRBY", `c:sum:${target}`, "rsum", stars - prev]];
  if (!prev) cmds.push(["HINCRBY", `c:sum:${target}`, "rcount", 1], ["HINCRBY", `c:uc:${uid}`, "reviews", 1], ["HINCRBY", "c:stat", "ratings", 1]);
  await pipe(cmds);
  const s = toSummary(pairs(await cmd(["HGETALL", `c:sum:${target}`])));
  // Ranked by a weighted average so one 5-star rating doesn't top the list.
  await cmd(["ZADD", "c:rated", ((s.ratingAvg * s.ratingCount + 3.5 * 3) / (s.ratingCount + 3)).toFixed(4), target]);
}

export async function setRating(secret: string, target: string, stars: unknown, meta: TargetMeta | undefined) {
  const me = await requireProfile(secret);
  checkTarget(target);
  const n = Math.round(Number(stars));
  if (!(n >= 1 && n <= 5)) throw new CommunityError("Pick 1 to 5 stars.");
  await limit(`u:${me.id}:rate`, 60, 3600);
  await rate(me.id, target, n);
  await rememberMeta(meta);
}

export async function setPlan(secret: string, target: string, plan: "going" | "interested" | "none", meta: TargetMeta | undefined) {
  const me = await requireProfile(secret);
  checkTarget(target);
  await limit(`u:${me.id}:plan`, 120, 3600);
  const [wasGoing, wasInt] = (await pipe([["SISMEMBER", `c:go:${target}`, me.id], ["SISMEMBER", `c:in:${target}`, me.id]])).map(Boolean);
  const cmds: Cmd[] = [];
  if (wasGoing && plan !== "going") cmds.push(["SREM", `c:go:${target}`, me.id], ["HINCRBY", `c:sum:${target}`, "going", -1], ["ZREM", `c:ugo:${me.id}`, target], ["HINCRBY", `c:uc:${me.id}`, "going", -1], hot(target, -3));
  if (wasInt && plan !== "interested") cmds.push(["SREM", `c:in:${target}`, me.id], ["HINCRBY", `c:sum:${target}`, "interested", -1], hot(target, -1));
  if (plan === "going" && !wasGoing)
    cmds.push(["SADD", `c:go:${target}`, me.id], ["HINCRBY", `c:sum:${target}`, "going", 1], ["ZADD", `c:ugo:${me.id}`, Date.now(), target], ["HINCRBY", `c:uc:${me.id}`, "going", 1], ["HINCRBY", "c:stat", "plans", 1], ["ZINCRBY", "c:karma", 1, me.id], hot(target, 3));
  if (plan === "interested" && !wasInt) cmds.push(["SADD", `c:in:${target}`, me.id], ["HINCRBY", `c:sum:${target}`, "interested", 1], hot(target, 1));
  await pipe(cmds);
  await rememberMeta(meta);
}

/**
 * Sets the member's reaction to a post (one per post; ❤️ is the classic like), or removes it
 * with null. The author earns points and a notice for a new reaction, not for a change.
 */
export async function react(secret: string, postId: string, emoji: unknown): Promise<{ reactions: Record<string, number>; mine?: string }> {
  const me = await requireProfile(secret);
  const post = json<Post>(await cmd(["GET", `c:p:${postId}`]));
  if (!post || post.deleted || post.hidden) throw new CommunityError("That post is gone.", 404);
  const want = emoji == null || emoji === "" ? undefined : String(emoji);
  if (want !== undefined && !(REACTIONS as readonly string[]).includes(want)) throw new CommunityError("Pick one of the reactions.");
  const self = post.author === me.id;
  if (!self && want && (await blocks(post.author, me.id))) throw new CommunityError("You can't react to this member's posts.", 403);
  await limit(`u:${me.id}:like`, 300, 3600);
  const [liked, other] = await pipe([["SISMEMBER", `c:liked:${me.id}`, postId], ["HGET", `c:urx:${me.id}`, postId]]);
  const prev = Number(liked) === 1 ? "❤️" : typeof other === "string" && other ? other : undefined;
  if (prev !== want) {
    const cmds: Cmd[] = [];
    if (prev === "❤️") cmds.push(["SREM", `c:liked:${me.id}`, postId], ["HINCRBY", `c:lk:${post.target}`, postId, -1]);
    else if (prev) cmds.push(["HDEL", `c:urx:${me.id}`, postId], ["HINCRBY", `c:rx:${post.target}`, `${postId}|${prev}`, -1]);
    if (want === "❤️") cmds.push(["SADD", `c:liked:${me.id}`, postId], ["HINCRBY", `c:lk:${post.target}`, postId, 1]);
    else if (want) cmds.push(["HSET", `c:urx:${me.id}`, postId, want], ["HINCRBY", `c:rx:${post.target}`, `${postId}|${want}`, 1]);
    if (!self && !prev && want)
      cmds.push(["HINCRBY", `c:uc:${post.author}`, "likes", 1], ["ZINCRBY", "c:karma", 2, post.author], hot(post.target, 0.5), ...(await notice(post.author, { type: want === "❤️" ? "like" : "react", emoji: want, by: me.id, post: postId, target: post.target, at: now() })));
    if (!self && prev && !want) cmds.push(["HINCRBY", `c:uc:${post.author}`, "likes", -1], ["ZINCRBY", "c:karma", -2, post.author], hot(post.target, -0.5));
    await pipe(cmds);
  }
  const [read] = await loadPosts([postId], me.id);
  return { reactions: read?.reactions ?? {}, mine: want };
}

/** The classic like: ❤️ on, or off. */
export async function toggleLike(secret: string, postId: string): Promise<{ liked: boolean; likes: number }> {
  const me = await requireProfile(secret);
  const liked = Number(await cmd(["SISMEMBER", `c:liked:${me.id}`, postId])) === 1;
  const r = await react(secret, postId, liked ? null : "❤️");
  return { liked: r.mine === "❤️", likes: r.reactions["❤️"] ?? 0 };
}

/** "I'm in" on a meet-up post; its author hears about new people joining. */
export async function toggleJoin(secret: string, postId: string): Promise<{ joined: boolean; joins: number }> {
  const me = await requireProfile(secret);
  const post = json<Post>(await cmd(["GET", `c:p:${postId}`]));
  if (!post || post.deleted || post.hidden || post.kind !== "meetup" || post.parent) throw new CommunityError("That meet-up is gone.", 404);
  if (post.author === me.id) throw new CommunityError("It's your own meet-up.");
  if (await blocks(post.author, me.id)) throw new CommunityError("You can't join this member's meet-ups.", 403);
  await limit(`u:${me.id}:join`, 60, 3600);
  const added = Number(await cmd(["SADD", `c:mj:${postId}`, me.id])) === 1;
  if (!added) await cmd(["SREM", `c:mj:${postId}`, me.id]);
  const res = await pipe([
    ...(added ? await notice(post.author, { type: "join", by: me.id, post: postId, target: post.target, at: now() }) : []),
    ["SCARD", `c:mj:${postId}`],
  ]);
  return { joined: added, joins: Number(res[res.length - 1] ?? 0) };
}

export async function deletePost(secret: string, postId: string) {
  const me = await requireProfile(secret);
  const post = json<Post>(await cmd(["GET", `c:p:${postId}`]));
  if (!post) return;
  if (post.author !== me.id) throw new CommunityError("You can only delete your own posts.", 403);
  // Keep a placeholder so replies still make sense; the words and rating go.
  const gone: Post = { ...post, text: "", deleted: true, rating: undefined };
  await pipe([
    ["SET", `c:p:${postId}`, JSON.stringify(gone)],
    ["ZREM", "c:feed", postId],
    ["ZREM", `c:up:${me.id}`, postId],
    ["HINCRBY", `c:uc:${me.id}`, "posts", -1],
    ["HINCRBY", `c:sum:${post.target}`, "posts", -1],
  ]);
}

export async function editPost(secret: string, postId: string, text: unknown): Promise<Post> {
  const me = await requireProfile(secret);
  const post = json<Post>(await cmd(["GET", `c:p:${postId}`]));
  if (!post || post.deleted) throw new CommunityError("That post is gone.", 404);
  if (post.author !== me.id) throw new CommunityError("You can only edit your own posts.", 403);
  const clean = cleanText(text, { min: post.kind === "review" ? 0 : 2 });
  checkSafety(clean);
  if (LINK_RE.test(clean) && !LINK_RE.test(post.text) && Date.now() - Date.parse(me.createdAt) < 86400000) throw new CommunityError("New members can share links after their first day. Describe it in words for now.");
  const next: Post = { ...post, text: clean, editedAt: now() };
  await cmd(["SET", `c:p:${postId}`, JSON.stringify(next)]);
  return next;
}

/**
 * Reports a post with a reason. Three reports hide it for everyone; two are enough when both
 * say it's a scam or shares private details.
 */
export async function reportPost(secret: string, postId: string, reason?: unknown) {
  const me = await requireProfile(secret);
  const post = json<Post>(await cmd(["GET", `c:p:${postId}`]));
  if (!post) return;
  if (post.author === me.id) throw new CommunityError("You can't report your own post. You can edit or delete it.");
  await limit(`u:${me.id}:report`, 20, 3600);
  const why = typeof reason === "string" && reason in REPORT_REASONS ? reason : "other";
  const [, , n, reasons] = await pipe([
    ["SADD", `c:rep:${postId}`, me.id],
    ["HSET", `c:repr:${postId}`, me.id, why],
    ["SCARD", `c:rep:${postId}`],
    ["HGETALL", `c:repr:${postId}`],
  ]);
  const serious = Object.values(pairs(reasons)).filter((r) => r === "scam" || r === "private").length;
  if ((Number(n) >= 3 || serious >= 2) && !post.hidden) await pipe([["SET", `c:p:${postId}`, JSON.stringify({ ...post, hidden: true })], ["ZREM", "c:feed", postId]]);
}

// ---- Notifications ---------------------------------------------------------------------

function notify(to: string, n: Notice): Cmd[] {
  if (to === n.by) return [];
  return [["LPUSH", `c:n:${to}`, JSON.stringify(n)], ["LTRIM", `c:n:${to}`, 0, 49], ["INCR", `c:nu:${to}`]];
}

/** A notice, unless the recipient has blocked its sender. */
async function notice(to: string, n: Notice): Promise<Cmd[]> {
  if (to === n.by || (await blocks(to, n.by))) return [];
  return notify(to, n);
}

// ---- Blocking ------------------------------------------------------------------------------

/** True if `who` has blocked `by`. */
async function blocks(who: string, by: string): Promise<boolean> {
  return Number(await cmd(["SISMEMBER", `c:blk:${who}`, by])) === 1;
}

async function blockedBy(viewer?: string): Promise<Set<string>> {
  if (!viewer) return new Set();
  return new Set(((await cmd<string[]>(["SMEMBERS", `c:blk:${viewer}`])) ?? []) as string[]);
}

/** Blocks or unblocks a member. Blocking also ends following in both directions. */
export async function toggleBlock(secret: string, targetId: string): Promise<{ blocked: boolean }> {
  const me = await requireProfile(secret);
  if (targetId === me.id) throw new CommunityError("You can't block yourself.");
  if (!(await getProfile(targetId))) throw new CommunityError("No member with that name.", 404);
  await limit(`u:${me.id}:block`, 60, 3600);
  if (await blocks(me.id, targetId)) {
    await cmd(["SREM", `c:blk:${me.id}`, targetId]);
    return { blocked: false };
  }
  await pipe([
    ["SADD", `c:blk:${me.id}`, targetId],
    ["SREM", `c:fol:${me.id}`, targetId],
    ["SREM", `c:fby:${targetId}`, me.id],
    ["SREM", `c:fol:${targetId}`, me.id],
    ["SREM", `c:fby:${me.id}`, targetId],
  ]);
  return { blocked: true };
}

/** The members someone has blocked, to manage the list. */
export async function getBlocked(viewer: string): Promise<PublicProfile[]> {
  const ids = [...(await blockedBy(viewer))];
  const profiles = await getProfiles(ids);
  return ids.map((id) => profiles[id]).filter(Boolean);
}

export async function getNotices(viewer: string): Promise<Notices> {
  const [raw, unread] = await pipe([["LRANGE", `c:n:${viewer}`, 0, 29], ["GET", `c:nu:${viewer}`]]);
  const hidden = await blockedBy(viewer);
  const list = ((raw as string[]) ?? []).map((r) => json<Notice>(r)).filter((n): n is Notice => !!n && !hidden.has(n.by));
  const [meta, profiles] = await Promise.all([metas([...new Set(list.map((n) => n.target))]), getProfiles(list.map((n) => n.by))]);
  return { items: list.map((n) => ({ ...n, meta: meta[n.target] })), unread: Number(unread ?? 0), profiles };
}

export async function unreadNotices(viewer: string): Promise<number> {
  return Number((await cmd(["GET", `c:nu:${viewer}`])) ?? 0);
}

export async function markNoticesSeen(secret: string) {
  const me = await requireProfile(secret);
  await cmd(["SET", `c:nu:${me.id}`, 0]);
}

// ---- Following ---------------------------------------------------------------------------

/** Follows or unfollows a member; they hear about a new follower. */
export async function toggleFollow(secret: string, targetId: string): Promise<{ following: boolean; followers: number }> {
  const me = await requireProfile(secret);
  if (targetId === me.id) throw new CommunityError("You can't follow yourself.");
  if (!(await getProfile(targetId))) throw new CommunityError("No member with that name.", 404);
  await limit(`u:${me.id}:follow`, 60, 3600);
  const was = Number(await cmd(["SISMEMBER", `c:fol:${me.id}`, targetId])) === 1;
  if (!was && ((await blocks(targetId, me.id)) || (await blocks(me.id, targetId)))) throw new CommunityError("You can't follow this member.", 403);
  const cmds: Cmd[] = was
    ? [["SREM", `c:fol:${me.id}`, targetId], ["SREM", `c:fby:${targetId}`, me.id]]
    : [["SADD", `c:fol:${me.id}`, targetId], ["SADD", `c:fby:${targetId}`, me.id], ...notify(targetId, { type: "follow", by: me.id, post: "", target: "", at: now() })];
  cmds.push(["SCARD", `c:fby:${targetId}`]);
  const res = await pipe(cmds);
  return { following: !was, followers: Number(res[res.length - 1] ?? 0) };
}

/** Posts and plans of the members the viewer follows, newest first. */
export async function getFollowingFeed(viewer: string): Promise<FollowingFeed> {
  const ids = (((await cmd<string[]>(["SMEMBERS", `c:fol:${viewer}`])) ?? []) as string[]).slice(0, 150);
  if (!ids.length) return { feed: [], plans: [], profiles: {}, following: 0 };
  const res = await pipe(ids.flatMap((id): Cmd[] => [["ZREVRANGE", `c:up:${id}`, 0, 9, "WITHSCORES"], ["ZREVRANGE", `c:ugo:${id}`, 0, 4, "WITHSCORES"]]));
  const postScores: [string, number][] = [];
  const planList: { by: string; target: string; t: number }[] = [];
  ids.forEach((id, i) => {
    const posts = (res[i * 2] as string[]) ?? [];
    for (let j = 0; j + 1 < posts.length; j += 2) postScores.push([posts[j], Number(posts[j + 1])]);
    const plans = (res[i * 2 + 1] as string[]) ?? [];
    for (let j = 0; j + 1 < plans.length; j += 2) planList.push({ by: id, target: plans[j], t: Number(plans[j + 1]) });
  });
  postScores.sort((a, b) => b[1] - a[1]);
  planList.sort((a, b) => b.t - a.t);
  const posts = (await loadPosts(postScores.slice(0, 40).map(([id]) => id), viewer)).filter((p) => !p.deleted && !p.hidden);
  const plans = planList.slice(0, 20);
  const [meta, profiles] = await Promise.all([metas([...new Set([...posts.map((p) => p.target), ...plans.map((p) => p.target)])]), getProfiles([...posts.map((p) => p.author), ...posts.flatMap((p) => p.joiners ?? []), ...plans.map((p) => p.by)])]);
  return {
    feed: posts.map((post) => ({ post, meta: meta[post.target] })),
    plans: plans.filter((p) => meta[p.target]).map((p) => ({ by: p.by, at: new Date(p.t).toISOString(), meta: meta[p.target] })),
    profiles,
    following: ids.length,
  };
}

// ---- Community home, profiles ------------------------------------------------------------

/** What people engaged with most: this week counts fully, last week half, so the list moves without emptying on Mondays. */
export async function trending(limit = 12, prefix = ""): Promise<string[]> {
  const w = week();
  const res = await pipe([
    ["ZREVRANGE", `c:hot:${w}`, 0, 59, "WITHSCORES"],
    ["ZREVRANGE", `c:hot:${w - 1}`, 0, 59, "WITHSCORES"],
  ]);
  const heat = new Map<string, number>();
  res.forEach((v, i) => {
    const list = (v as string[]) ?? [];
    for (let j = 0; j + 1 < list.length; j += 2) heat.set(list[j], (heat.get(list[j]) ?? 0) + Number(list[j + 1]) * (i ? 0.5 : 1));
  });
  return [...heat.entries()].filter(([t, s]) => s > 0 && t.startsWith(prefix)).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
}

export async function getHome(viewer?: string): Promise<CommunityHome> {
  const res = await pipe([
    ["HGETALL", "c:stat"],
    ["ZREVRANGE", "c:feed", 0, 39],
    ["ZREVRANGE", "c:rated", 0, 11],
    ["ZREVRANGE", "c:karma", 0, 9],
  ]);
  const stat = pairs(res[0]);
  const posts = await loadPosts((res[1] as string[]) ?? [], viewer);
  const hotList = await trending(12);
  const rated = ((res[2] as string[]) ?? []).filter(Boolean);
  const leaderIds = ((res[3] as string[]) ?? []).filter(Boolean);
  const targets = [...new Set([...posts.map((p) => p.target), ...hotList, ...rated])];
  const [meta, sums, profiles] = await Promise.all([metas(targets), summaries([...hotList, ...rated]), getProfiles([...posts.map((p) => p.author), ...posts.flatMap((p) => p.joiners ?? []), ...leaderIds])]);
  const feed: FeedItem[] = posts.map((post) => ({ post, meta: meta[post.target] }));
  const withMeta = (ts: string[]) => ts.filter((t) => meta[t] && sums[t]).map((t) => ({ ...meta[t], ...sums[t] }));
  return {
    stats: { members: Number(stat.members ?? 0), posts: Number(stat.posts ?? 0), ratings: Number(stat.ratings ?? 0), plans: Number(stat.plans ?? 0) },
    feed,
    trending: withMeta(hotList),
    topRated: withMeta(rated).filter((x) => x.ratingCount > 0),
    leaders: leaderIds.map((id) => profiles[id]).filter(Boolean),
    profiles,
    persistent,
  };
}

export async function getMember(id: string, viewer?: string) {
  const profile = await getProfile(id);
  if (!profile) return undefined;
  const [postIds, plans, followers, following, followed, blocked] = await pipe([
    ["ZREVRANGE", `c:up:${id}`, 0, 49],
    ["ZREVRANGE", `c:ugo:${id}`, 0, 49],
    ["SCARD", `c:fby:${id}`],
    ["SCARD", `c:fol:${id}`],
    ["SISMEMBER", `c:fol:${viewer ?? "-"}`, id],
    ["SISMEMBER", `c:blk:${viewer ?? "-"}`, id],
  ]);
  const blockedByViewer = Number(blocked) === 1;
  const posts = blockedByViewer ? [] : (await loadPosts((postIds as string[]) ?? [], viewer)).filter((p) => !p.deleted);
  const meta = await metas([...new Set([...posts.map((p) => p.target), ...((plans as string[]) ?? [])])]);
  return {
    profile,
    posts: posts.map((post) => ({ post, meta: meta[post.target] })),
    plans: ((plans as string[]) ?? []).map((t) => meta[t]).filter(Boolean),
    follow: { followers: Number(followers ?? 0), following: Number(following ?? 0), byViewer: Number(followed) === 1 },
    blockedByViewer,
    persistent,
  };
}

export { persistent };
