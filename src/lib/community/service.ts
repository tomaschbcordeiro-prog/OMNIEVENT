import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { cmd, pairs, persistent, pipe, type Cmd } from "./kv";
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
 * - Posts are plain text, rate-limited, and hidden after three reports.
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

function checkPassword(raw: unknown): string {
  const pw = String(raw ?? "");
  if (pw.length < 8) throw new CommunityError("Use at least 8 characters for the password.");
  if (pw.length > 128) throw new CommunityError("That password is too long.");
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
  const password = checkPassword(input.password);
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
    ["SET", sessionKey(secret), id, "EX", SESSION_TTL],
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
  if (!account || !(await passwordMatches(String(input.password ?? "").normalize("NFKC"), account.pw))) throw new CommunityError("Wrong email, username or password.", 401);
  await cmd(["SET", sessionKey(secret), account.id, "EX", SESSION_TTL]);
  return (await getProfile(account.id))!;
}

export async function signOut(secret: string) {
  if (typeof secret === "string" && secret.length >= 20) await cmd(["DEL", sessionKey(secret)]);
}

export async function changePassword(secret: string, input: Record<string, unknown>, ip: string) {
  const me = await requireProfile(secret);
  await limit(`acct:${me.id}:signin`, 10, 900);
  const account = await getAccount(me.id);
  if (!account || !(await passwordMatches(String(input.current ?? "").normalize("NFKC"), account.pw))) throw new CommunityError("Your current password isn't right.", 401);
  account.pw = await hashPassword(checkPassword(input.next));
  await cmd(["SET", `c:acct:${me.id}`, JSON.stringify(account)]);
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
  const plans = ((await cmd<string[]>(["ZRANGE", `c:ugo:${me.id}`, 0, -1])) ?? []).filter(Boolean);
  await pipe([
    ...plans.flatMap((t): Cmd[] => [["SREM", `c:go:${t}`, me.id], ["HINCRBY", `c:sum:${t}`, "going", -1]]),
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
  const posts = raw.map((r) => json<Post>(r)).filter((p): p is Post => !!p && !p.hidden);
  const targets = [...new Set(posts.map((p) => p.target))];
  const res = await pipe([
    ...targets.map((t): Cmd => ["HGETALL", `c:lk:${t}`]),
    ...(viewer && posts.length ? [["SMISMEMBER", `c:liked:${viewer}`, ...posts.map((p) => p.id)] as Cmd] : []),
  ]);
  const likes: Record<string, string> = Object.assign({}, ...targets.map((_, i) => pairs(res[i])));
  const mine = viewer && posts.length ? (res[targets.length] as number[]) : [];
  return posts.map((p, i) => ({ ...p, likes: Number(likes[p.id] ?? 0), liked: !!mine[i] }));
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
  const goingPeople = ((res[3] as string[]) ?? []).filter(Boolean);
  const profiles = await getProfiles([...posts.map((p) => p.author), ...goingPeople]);
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
    if (!p || p.target !== input.target) throw new CommunityError("That conversation is gone.");
    parent = p.parent ?? p.id; // one level of replies
    replyTo = p;
  }
  const text = cleanText(input.text, { min: kind === "review" ? 0 : 2 });
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
  ];
  if (replyTo) {
    const n: Notice = { type: "reply", by: me.id, post: post.id, target: post.target, at: post.createdAt, text: text.slice(0, 120) };
    cmds.push(...notify(replyTo.author, n));
    // The author of the conversation hears about replies to other replies in it too.
    if (replyTo.parent) {
      const top = json<Post>(await cmd(["GET", `c:p:${replyTo.parent}`]));
      if (top && top.author !== replyTo.author) cmds.push(...notify(top.author, n));
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

export async function toggleLike(secret: string, postId: string): Promise<{ liked: boolean; likes: number }> {
  const me = await requireProfile(secret);
  const post = json<Post>(await cmd(["GET", `c:p:${postId}`]));
  if (!post || post.deleted) throw new CommunityError("That post is gone.", 404);
  await limit(`u:${me.id}:like`, 200, 3600);
  const added = Number(await cmd(["SADD", `c:liked:${me.id}`, postId])) === 1;
  if (!added) await cmd(["SREM", `c:liked:${me.id}`, postId]);
  const self = post.author === me.id;
  const [likes] = await pipe([
    ["HINCRBY", `c:lk:${post.target}`, postId, added ? 1 : -1],
    ...(self ? [] : ([["HINCRBY", `c:uc:${post.author}`, "likes", added ? 1 : -1], ["ZINCRBY", "c:karma", added ? 2 : -2, post.author]] as Cmd[])),
    hot(post.target, added ? 0.5 : -0.5),
    ...(added ? notify(post.author, { type: "like", by: me.id, post: postId, target: post.target, at: now() }) : []),
  ]);
  return { liked: added, likes: Math.max(0, Number(likes)) };
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
  const next: Post = { ...post, text: cleanText(text, { min: post.kind === "review" ? 0 : 2 }), editedAt: now() };
  await cmd(["SET", `c:p:${postId}`, JSON.stringify(next)]);
  return next;
}

export async function reportPost(secret: string, postId: string) {
  const me = await requireProfile(secret);
  const post = json<Post>(await cmd(["GET", `c:p:${postId}`]));
  if (!post) return;
  await limit(`u:${me.id}:report`, 20, 3600);
  await cmd(["SADD", `c:rep:${postId}`, me.id]);
  const n = Number(await cmd(["SCARD", `c:rep:${postId}`]));
  if (n >= 3 && !post.hidden) await pipe([["SET", `c:p:${postId}`, JSON.stringify({ ...post, hidden: true })], ["ZREM", "c:feed", postId]]);
}

// ---- Notifications ---------------------------------------------------------------------

function notify(to: string, n: Notice): Cmd[] {
  if (to === n.by) return [];
  return [["LPUSH", `c:n:${to}`, JSON.stringify(n)], ["LTRIM", `c:n:${to}`, 0, 49], ["INCR", `c:nu:${to}`]];
}

export async function getNotices(viewer: string): Promise<Notices> {
  const [raw, unread] = await pipe([["LRANGE", `c:n:${viewer}`, 0, 29], ["GET", `c:nu:${viewer}`]]);
  const list = ((raw as string[]) ?? []).map((r) => json<Notice>(r)).filter((n): n is Notice => !!n);
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
  const [meta, sums, profiles] = await Promise.all([metas(targets), summaries([...hotList, ...rated]), getProfiles([...posts.map((p) => p.author), ...leaderIds])]);
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
  const [postIds, plans] = (await pipe([["ZREVRANGE", `c:up:${id}`, 0, 49], ["ZREVRANGE", `c:ugo:${id}`, 0, 49]])) as string[][];
  const posts = (await loadPosts(postIds ?? [], viewer)).filter((p) => !p.deleted);
  const meta = await metas([...new Set([...posts.map((p) => p.target), ...(plans ?? [])])]);
  return { profile, posts: posts.map((post) => ({ post, meta: meta[post.target] })), plans: (plans ?? []).map((t) => meta[t]).filter(Boolean), persistent };
}

export { persistent };
