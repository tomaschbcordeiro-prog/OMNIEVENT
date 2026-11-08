import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";

// Unpacked on the main thread (about half a second for the biggest copy): done on Node's small
// pool of worker threads instead, it could wait behind other work there (slow name lookups)
// and a new server never finished loading.
const gunzip = async (b: Buffer) => gunzipSync(b);
const gzip = async (b: Buffer) => gzipSync(b);
import { getCache, type RuntimeCache } from "@vercel/functions";
import { cmd, persistent, pipe, storageAvailable } from "./community/kv";
import type { ProviderBatch } from "./providers/types";

/**
 * Data shared by every server instance:
 *
 * - Snapshots of each source's latest results, so a fresh instance starts with everything
 *   in about a second instead of re-reading every source, and sources with a daily quota
 *   (Ticketmaster) are read once for all instances instead of once per instance.
 * - Locks, so only one instance reads a given source at a time.
 * - Small JSON state, such as where a long catalogue crawl stopped.
 *
 * Kept in Vercel's Runtime Cache when the site runs on Vercel (shared by every instance in
 * the region and kept across deployments, no account of its own), otherwise in the
 * community's Redis (Upstash). Without either (local development, tests) every function is
 * a no-op.
 */

/** Vercel's Runtime Cache, when running there. */
const rc: RuntimeCache | null = process.env.VERCEL === "1" ? getCache({ namespace: "omni-shared" }) : null;

export const sharedEnabled = !!rc || persistent;

/** Whether a shared store is answering right now (Runtime Cache, or Redis within its plan). */
export function sharedStoreUp(): boolean {
  return !!rc || storageAvailable();
}

const CHUNK = Number(process.env.SHARED_CHUNK_BYTES ?? 900_000);
/** Runtime Cache items are limited to 2 MB. */
const RC_CHUNK = 700_000;
const INDEX = "snap:index";
const TTL = 3 * 86400;

export interface SnapshotMeta {
  ver: string;
  n: number;
  at: number;
  events: number;
}

/** Runs `fn` over `items`, `limit` at a time. */
async function inBatches<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  for (let i = 0; i < items.length; i += limit) await Promise.all(items.slice(i, i + limit).map(async (x, j) => (out[i + j] = await fn(x, i + j))));
  return out;
}

/** Saves a source's batch, compressed and split into chunks under the store's size limits. */
export async function saveSnapshot(id: string, batch: ProviderBatch, at = Date.now()): Promise<void> {
  if (!sharedEnabled) return;
  const data = (await gzip(Buffer.from(JSON.stringify(batch)))).toString("base64");
  if (rc) {
    // Each copy has its own version; readers only follow the meta entry, written last, and
    // older copies expire by themselves.
    const ver = at.toString(36) + Math.random().toString(36).slice(2, 6);
    const n = Math.max(1, Math.ceil(data.length / RC_CHUNK));
    await inBatches(Array.from({ length: n }, (_, i) => i), 4, (i) => rc.set(`snap:${id}:${ver}:${i}`, data.slice(i * RC_CHUNK, (i + 1) * RC_CHUNK), { ttl: TTL, name: `snapshot ${id} ${i + 1}/${n}` }));
    const meta: SnapshotMeta = { ver, n, at, events: batch.events.length };
    await rc.set(`snap:meta:${id}`, meta, { ttl: TTL, name: `snapshot ${id}` });
    return;
  }
  // Two slots per source, used in turn: readers keep the current one while the other is
  // rewritten, and storage never holds more than two copies of a source.
  const current = (await snapshotIndex())[id];
  const ver = current?.ver === "a" ? "b" : "a";
  const n = Math.max(1, Math.ceil(data.length / CHUNK));
  for (let i = 0; i < n; i++) await cmd(["SET", `snap:${id}:${ver}:${i}`, data.slice(i * CHUNK, (i + 1) * CHUNK), "EX", TTL]);
  const meta: SnapshotMeta = { ver, n, at, events: batch.events.length };
  await cmd(["HSET", INDEX, id, JSON.stringify(meta)]);
  // Chunks left over from a bigger earlier copy in this slot.
  const stale = Array.from({ length: 40 }, (_, i) => `snap:${id}:${ver}:${n + i}`);
  await cmd(["DEL", ...stale]).catch(() => {});
}

/**
 * Removes snapshot chunks that no index entry points to (older versions). Run at most once
 * an hour across all instances. (Runtime Cache copies expire by themselves.)
 */
export async function cleanupSnapshots(): Promise<number> {
  if (rc || !persistent) return 0;
  if (!(await acquireLock("snapshot-cleanup", 3600))) return 0;
  const index = await snapshotIndex();
  let cursor = "0";
  let removed = 0;
  do {
    const [next, keys] = (await cmd<[string, string[]]>(["SCAN", cursor, "MATCH", "snap:*", "COUNT", 1000])) ?? ["0", []];
    cursor = String(next);
    const drop = keys.filter((k) => {
      if (k === INDEX) return false;
      const [, id, ver] = k.split(":");
      return index[id]?.ver !== ver;
    });
    if (drop.length) {
      await cmd(["DEL", ...drop]);
      removed += drop.length;
    }
  } while (cursor !== "0");
  return removed;
}

/** What each source last saved (with the Runtime Cache, for the sources named in `ids`). */
export async function snapshotIndex(ids: string[] = []): Promise<Record<string, SnapshotMeta>> {
  if (rc) {
    const metas = await inBatches(ids, 10, (id) => rc.get(`snap:meta:${id}`).catch(() => null));
    const out: Record<string, SnapshotMeta> = {};
    ids.forEach((id, i) => {
      const m = metas[i] as SnapshotMeta | null;
      if (m && typeof m.ver === "string" && Number.isInteger(m.n) && m.n > 0 && m.n < 500) out[id] = m;
    });
    return out;
  }
  if (!persistent) return {};
  const raw = (await cmd<unknown>(["HGETALL", INDEX])) ?? [];
  const out: Record<string, SnapshotMeta> = {};
  const pairs = Array.isArray(raw) ? raw : Object.entries(raw as Record<string, string>).flat();
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    try {
      out[String(pairs[i])] = JSON.parse(String(pairs[i + 1])) as SnapshotMeta;
    } catch {
      // ignore a damaged entry
    }
  }
  return out;
}

export async function loadSnapshot(id: string, meta: SnapshotMeta): Promise<ProviderBatch | undefined> {
  if (rc) {
    const parts = await inBatches(Array.from({ length: meta.n }, (_, i) => i), 12, (i) => rc.get(`snap:${id}:${meta.ver}:${i}`).catch(() => null));
    if (parts.some((p) => typeof p !== "string")) return undefined;
    return JSON.parse((await gunzip(Buffer.from(parts.join(""), "base64"))).toString("utf8")) as ProviderBatch;
  }
  if (!persistent) return undefined;
  // One chunk per request: a single reply carrying every chunk can exceed Redis' size limit.
  const parts: (string | null)[] = new Array(meta.n).fill(null);
  for (let i = 0; i < meta.n; i += 8)
    await Promise.all(
      Array.from({ length: Math.min(8, meta.n - i) }, async (_, j) => {
        parts[i + j] = await cmd<string | null>(["GET", `snap:${id}:${meta.ver}:${i + j}`]);
      }),
    );
  if (parts.some((p) => typeof p !== "string")) return undefined;
  return JSON.parse((await gunzip(Buffer.from(parts.join(""), "base64"))).toString("utf8")) as ProviderBatch;
}

/** True when this instance now holds the lock; it expires by itself after `ttlSec`. */
export async function acquireLock(name: string, ttlSec: number): Promise<boolean> {
  if (rc) {
    // Not atomic (two instances can both win a race), which is fine for sparing work.
    try {
      const held = (await rc.get(`lock:${name}`)) as number | null;
      if (typeof held === "number" && Date.now() - held < ttlSec * 1000) return false;
      await rc.set(`lock:${name}`, Date.now(), { ttl: ttlSec });
    } catch {
      // storage trouble shouldn't stop syncing altogether
    }
    return true;
  }
  if (!persistent) return true;
  try {
    return (await cmd(["SET", `lock:${name}`, String(Date.now()), "NX", "EX", ttlSec])) === "OK";
  } catch {
    return true; // storage trouble shouldn't stop syncing altogether
  }
}

export async function releaseLock(name: string): Promise<void> {
  if (rc) await rc.delete(`lock:${name}`).catch(() => {});
  else if (persistent) await cmd(["DEL", `lock:${name}`]).catch(() => {});
}

export async function getState<T>(key: string): Promise<T | undefined> {
  if (rc) return (((await rc.get(`state:${key}`).catch(() => null)) ?? undefined) as T | undefined);
  if (!persistent) return undefined;
  const v = await cmd<string | null>(["GET", `state:${key}`]).catch(() => null);
  try {
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Several state values at once (missing ones are undefined). */
export async function getStates<T>(keys: string[]): Promise<(T | undefined)[]> {
  if (rc) return inBatches(keys, 10, async (k) => (((await rc.get(`state:${k}`).catch(() => null)) ?? undefined) as T | undefined));
  if (!persistent || !keys.length) return keys.map(() => undefined);
  const vals = (await cmd<(string | null)[]>(["MGET", ...keys.map((k) => `state:${k}`)]).catch(() => [])) ?? [];
  return keys.map((_, i) => {
    try {
      return vals[i] ? (JSON.parse(vals[i]!) as T) : undefined;
    } catch {
      return undefined;
    }
  });
}

export async function setState(key: string, value: unknown, ttlSec = 7 * 86400): Promise<void> {
  if (rc) {
    if (value === undefined) await rc.delete(`state:${key}`).catch(() => {});
    else await rc.set(`state:${key}`, value, { ttl: ttlSec }).catch(() => {});
    return;
  }
  if (!persistent) return;
  if (value === undefined) await pipe([["DEL", `state:${key}`]]).catch(() => {});
  else await cmd(["SET", `state:${key}`, JSON.stringify(value), "EX", ttlSec]).catch(() => {});
}
