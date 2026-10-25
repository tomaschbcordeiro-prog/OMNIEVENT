import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cmd, pairs, persistent, pipe, type Cmd } from "./kv";
import {
  AVATARS,
  BADGES,
  POST_KINDS,
  TARGET_RE,
  type CommunityHome,
  type FeedItem,
  type Post,
  type PostKind,
  type Profile,
  type PublicProfile,
  type Summary,
  type TargetMeta,
  type Thread,
} from "./types";

/**
 * Community: profiles, posts (chat, questions, tips, meet-ups, reviews), likes, ratings and
 * "going / interested" plans, attached to events, venues, performers/teams and cities.
 *
 * - No passwords: the browser keeps a random secret; its hash is the member id. Losing the
 *   secret (clearing site data) means starting a new profile.
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

export function cleanName(raw: unknown): string {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 24) throw new CommunityError("Names are 2 to 24 characters.");
  if (!/^[\p{L}\p{N} ._'-]+$/u.test(name)) throw new CommunityError("Use letters, numbers, spaces, dots, dashes or apostrophes.");
  return name;
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

export async function saveProfile(secret: string, input: { name?: unknown; avatar?: unknown; hue?: unknown; bio?: unknown }, ip: string): Promise<PublicProfile> {
  const id = memberId(secret);
  await limit(`ip:${ip}:profile`, 30, 3600);
  const prev = json<Profile>(await cmd(["GET", `c:u:${id}`]));
  const avatar = typeof input.avatar === "string" && AVATARS.includes(input.avatar) ? input.avatar : prev?.avatar ?? AVATARS[0];
  const hue = Number.isFinite(Number(input.hue)) ? Math.abs(Math.round(Number(input.hue))) % 360 : prev?.hue ?? 210;
  const bio = input.bio === undefined ? prev?.bio : String(input.bio).trim() ? cleanText(input.bio, { min: 1, max: 160 }) : undefined;
  const profile: Profile = { id, name: cleanName(input.name ?? prev?.name), avatar, hue, bio, createdAt: prev?.createdAt ?? now() };
  const cmds: Cmd[] = [["SET", `c:u:${id}`, JSON.stringify(profile)]];
  if (!prev) cmds.push(["HINCRBY", "c:stat", "members", 1], ["ZADD", "c:karma", 1, id]);
  await pipe(cmds);
  return (await getProfile(id))!;
}

async function requireProfile(secret: string): Promise<Profile> {
  if (typeof secret !== "string" || secret.length < 20) throw new CommunityError("Join the community first.", 401);
  const p = json<Profile>(await cmd(["GET", `c:u:${memberId(secret)}`]));
  if (!p) throw new CommunityError("Join the community first.", 401);
  return p;
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
  if (input.parent) {
    const p = json<Post>(await cmd(["GET", `c:p:${String(input.parent)}`]));
    if (!p || p.target !== input.target) throw new CommunityError("That conversation is gone.");
    parent = p.parent ?? p.id; // one level of replies
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

// ---- Community home, profiles ------------------------------------------------------------

export async function getHome(viewer?: string): Promise<CommunityHome> {
  const w = week();
  const res = await pipe([
    ["HGETALL", "c:stat"],
    ["ZREVRANGE", "c:feed", 0, 39],
    ["ZREVRANGE", `c:hot:${w}`, 0, 23, "WITHSCORES"],
    ["ZREVRANGE", `c:hot:${w - 1}`, 0, 23, "WITHSCORES"],
    ["ZREVRANGE", "c:rated", 0, 11],
    ["ZREVRANGE", "c:karma", 0, 9],
  ]);
  const stat = pairs(res[0]);
  const posts = await loadPosts((res[1] as string[]) ?? [], viewer);
  // This week counts fully, last week half, so the list moves without emptying on Mondays.
  const heat = new Map<string, number>();
  const add = (v: unknown, k: number) => {
    const list = (v as string[]) ?? [];
    for (let i = 0; i + 1 < list.length; i += 2) heat.set(list[i], (heat.get(list[i]) ?? 0) + Number(list[i + 1]) * k);
  };
  add(res[2], 1);
  add(res[3], 0.5);
  const hotList = [...heat.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
  const rated = ((res[4] as string[]) ?? []).filter(Boolean);
  const leaderIds = ((res[5] as string[]) ?? []).filter(Boolean);
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
