import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";
import { cmd, persistent, pipe } from "./community/kv";
import type { ProviderBatch } from "./providers/types";

/**
 * Data shared by every server instance through the community's Redis (Upstash):
 *
 * - Snapshots of each source's latest results, so a fresh instance starts with everything
 *   in about a second instead of re-reading every source, and sources with a daily quota
 *   (Ticketmaster) are read once for all instances instead of once per instance.
 * - Locks, so only one instance reads a given source at a time.
 * - Small JSON state, such as where a long catalogue crawl stopped.
 *
 * Without Redis (local development, tests) every function is a no-op.
 */

export const sharedEnabled = persistent;

const CHUNK = Number(process.env.SHARED_CHUNK_BYTES ?? 900_000);
const INDEX = "snap:index";
const TTL = 3 * 86400;

export interface SnapshotMeta {
  ver: string;
  n: number;
  at: number;
  events: number;
}

/** Saves a source's batch, compressed and split into chunks under Redis' request limits. */
export async function saveSnapshot(id: string, batch: ProviderBatch, at = Date.now()): Promise<void> {
  if (!persistent) return;
  const data = gzipSync(Buffer.from(JSON.stringify(batch))).toString("base64");
  const ver = at.toString(36);
  const n = Math.max(1, Math.ceil(data.length / CHUNK));
  for (let i = 0; i < n; i++) await cmd(["SET", `snap:${id}:${ver}:${i}`, data.slice(i * CHUNK, (i + 1) * CHUNK), "EX", TTL]);
  const meta: SnapshotMeta = { ver, n, at, events: batch.events.length };
  await cmd(["HSET", INDEX, id, JSON.stringify(meta)]);
}

/** What every source last saved (one request). */
export async function snapshotIndex(): Promise<Record<string, SnapshotMeta>> {
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
  if (!persistent) return undefined;
  // One chunk per request: a single reply carrying every chunk can exceed Redis' size limit.
  const parts: (string | null)[] = new Array(meta.n).fill(null);
  for (let i = 0; i < meta.n; i += 4)
    await Promise.all(
      Array.from({ length: Math.min(4, meta.n - i) }, async (_, j) => {
        parts[i + j] = await cmd<string | null>(["GET", `snap:${id}:${meta.ver}:${i + j}`]);
      }),
    );
  if (parts.some((p) => typeof p !== "string")) return undefined;
  return JSON.parse(gunzipSync(Buffer.from(parts.join(""), "base64")).toString("utf8")) as ProviderBatch;
}

/** True when this instance now holds the lock; it expires by itself after `ttlSec`. */
export async function acquireLock(name: string, ttlSec: number): Promise<boolean> {
  if (!persistent) return true;
  try {
    return (await cmd(["SET", `lock:${name}`, String(Date.now()), "NX", "EX", ttlSec])) === "OK";
  } catch {
    return true; // storage trouble shouldn't stop syncing altogether
  }
}

export async function releaseLock(name: string): Promise<void> {
  if (persistent) await cmd(["DEL", `lock:${name}`]).catch(() => {});
}

export async function getState<T>(key: string): Promise<T | undefined> {
  if (!persistent) return undefined;
  const v = await cmd<string | null>(["GET", `state:${key}`]).catch(() => null);
  try {
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
}

export async function setState(key: string, value: unknown, ttlSec = 7 * 86400): Promise<void> {
  if (!persistent) return;
  if (value === undefined) await pipe([["DEL", `state:${key}`]]).catch(() => {});
  else await cmd(["SET", `state:${key}`, JSON.stringify(value), "EX", ttlSec]).catch(() => {});
}
