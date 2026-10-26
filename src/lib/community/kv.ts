import "server-only";

/**
 * The few Redis commands the community uses, on Upstash Redis (REST) when it is connected,
 * or in this server's memory otherwise (local development and tests).
 *
 * Connect storage in Vercel: Storage → Create → Upstash for Redis → connect to the project.
 * That sets KV_REST_API_URL and KV_REST_API_TOKEN (UPSTASH_REDIS_REST_* also work).
 */

export type Cmd = (string | number)[];
type Val = unknown;

// Vercel may add a custom prefix to these names (e.g. STORAGE_KV_REST_API_URL), so match the ending.
const envEnding = (...ends: string[]) => {
  for (const end of ends) {
    const key = Object.keys(process.env).find((k) => k === end || k.endsWith(`_${end}`));
    if (key && process.env[key]) return process.env[key];
  }
  return undefined;
};
/** Shared with other server-side caches (see lib/shared-cache.ts). */
const URL_ = envEnding("KV_REST_API_URL", "UPSTASH_REDIS_REST_URL");
const TOKEN = envEnding("KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN");

export const persistent = !!(URL_ && TOKEN);

async function remote(cmds: Cmd[]): Promise<Val[]> {
  const res = await fetch(`${URL_}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds.map((c) => c.map(String))),
    cache: "no-store",
    // A request that hangs must not stall whatever waits on it.
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`community storage: HTTP ${res.status}`);
  const out = (await res.json()) as { result?: Val; error?: string }[];
  return out.map((r) => {
    if (r.error) throw new Error(`community storage: ${r.error}`);
    return r.result;
  });
}

// ---- In-memory stand-in ----------------------------------------------------------------

type Entry = { v: string | string[] | Set<string> | Map<string, string> | Map<string, number>; exp?: number; z?: true };
const g = globalThis as unknown as { __omniKv?: Map<string, Entry> };
const mem = (g.__omniKv ??= new Map());

function get(key: string): Entry | undefined {
  const e = mem.get(key);
  if (e?.exp && e.exp < Date.now()) {
    mem.delete(key);
    return undefined;
  }
  return e;
}
const set_ = (k: string) => (get(k)?.v as Set<string>) ?? (mem.set(k, { v: new Set<string>() }).get(k)!.v as Set<string>);
const hash = (k: string) => (get(k)?.v as Map<string, string>) ?? (mem.set(k, { v: new Map<string, string>() }).get(k)!.v as Map<string, string>);
const list_ = (k: string) => (get(k)?.v as string[]) ?? (mem.set(k, { v: [] as string[] }).get(k)!.v as string[]);
const zset = (k: string) => (get(k)?.v as Map<string, number>) ?? (mem.set(k, { v: new Map<string, number>(), z: true }).get(k)!.v as Map<string, number>);
const zsorted = (k: string, desc: boolean) => [...zset(k).entries()].sort((a, b) => (desc ? b[1] - a[1] : a[1] - b[1]) || (a[0] < b[0] ? -1 : 1));
const range = <T,>(list: T[], start: number, stop: number) => {
  const n = list.length;
  const s = start < 0 ? Math.max(0, n + start) : start;
  const e = stop < 0 ? n + stop : Math.min(stop, n - 1);
  return s > e ? [] : list.slice(s, e + 1);
};

function local(c: Cmd): Val {
  const [op, ...a] = c.map(String);
  const k = a[0];
  switch (op.toUpperCase()) {
    case "GET": {
      const e = get(k);
      return typeof e?.v === "string" ? e.v : null;
    }
    case "MGET":
      return a.map((x) => {
        const e = get(x);
        return typeof e?.v === "string" ? e.v : null;
      });
    case "SET": {
      if (a.some((x) => x.toUpperCase() === "NX") && get(k)) return null;
      const i = a.findIndex((x) => x.toUpperCase() === "EX");
      mem.set(k, { v: a[1], exp: i > 0 ? Date.now() + Number(a[i + 1]) * 1000 : undefined });
      return "OK";
    }
    case "DEL":
      return a.reduce((n, x) => n + (mem.delete(x) ? 1 : 0), 0);
    case "INCR":
    case "INCRBY": {
      const e = get(k);
      const n = Number(typeof e?.v === "string" ? e.v : 0) + (op.toUpperCase() === "INCR" ? 1 : Number(a[1]));
      mem.set(k, { v: String(n), exp: e?.exp });
      return n;
    }
    case "EXPIRE": {
      const e = get(k);
      if (!e) return 0;
      e.exp = Date.now() + Number(a[1]) * 1000;
      return 1;
    }
    case "SADD": {
      const s = set_(k);
      return a.slice(1).reduce((n, x) => (s.has(x) ? n : (s.add(x), n + 1)), 0);
    }
    case "SREM": {
      const s = set_(k);
      return a.slice(1).reduce((n, x) => n + (s.delete(x) ? 1 : 0), 0);
    }
    case "SCARD":
      return set_(k).size;
    case "SISMEMBER":
      return set_(k).has(a[1]) ? 1 : 0;
    case "SMISMEMBER": {
      const s = set_(k);
      return a.slice(1).map((x) => (s.has(x) ? 1 : 0));
    }
    case "SRANDMEMBER":
      return [...set_(k)].slice(-Number(a[1] ?? 1)).reverse();
    case "LPUSH": {
      const l = list_(k);
      l.unshift(...a.slice(1).reverse());
      return l.length;
    }
    case "LTRIM": {
      const l = list_(k);
      const kept = range(l, Number(a[1]), Number(a[2]));
      l.splice(0, l.length, ...kept);
      return "OK";
    }
    case "LRANGE":
      return range(list_(k), Number(a[1]), Number(a[2]));
    case "HSET": {
      const h = hash(k);
      let n = 0;
      for (let i = 1; i < a.length; i += 2) {
        if (!h.has(a[i])) n++;
        h.set(a[i], a[i + 1]);
      }
      return n;
    }
    case "HGET":
      return hash(k).get(a[1]) ?? null;
    case "HDEL": {
      const h = hash(k);
      return a.slice(1).reduce((n, x) => n + (h.delete(x) ? 1 : 0), 0);
    }
    case "HINCRBY": {
      const h = hash(k);
      const n = Number(h.get(a[1]) ?? 0) + Number(a[2]);
      h.set(a[1], String(n));
      return n;
    }
    case "HGETALL":
      return [...hash(k).entries()].flat();
    case "ZADD": {
      const z = zset(k);
      let n = 0;
      for (let i = 1; i < a.length; i += 2) {
        if (!z.has(a[i + 1])) n++;
        z.set(a[i + 1], Number(a[i]));
      }
      return n;
    }
    case "ZINCRBY": {
      const z = zset(k);
      const n = (z.get(a[2]) ?? 0) + Number(a[1]);
      z.set(a[2], n);
      return String(n);
    }
    case "ZREM": {
      const z = zset(k);
      return a.slice(1).reduce((n, x) => n + (z.delete(x) ? 1 : 0), 0);
    }
    case "ZSCORE": {
      const s = zset(k).get(a[1]);
      return s === undefined ? null : String(s);
    }
    case "ZCARD":
      return zset(k).size;
    case "ZRANGE":
    case "ZREVRANGE": {
      const withScores = a.some((x) => x.toUpperCase() === "WITHSCORES");
      const list = range(zsorted(k, op.toUpperCase() === "ZREVRANGE"), Number(a[1]), Number(a[2]));
      return withScores ? list.flatMap(([m, s]) => [m, String(s)]) : list.map(([m]) => m);
    }
    case "ZREMRANGEBYRANK": {
      const z = zset(k);
      for (const [m] of range(zsorted(k, false), Number(a[1]), Number(a[2]))) z.delete(m);
      return 0;
    }
    default:
      throw new Error(`memory kv: ${op} not supported`);
  }
}

/** Runs the commands in one round trip and returns their results in order. */
export async function pipe(cmds: Cmd[]): Promise<Val[]> {
  if (!cmds.length) return [];
  return persistent ? remote(cmds) : cmds.map(local);
}

export async function cmd<T = Val>(c: Cmd): Promise<T> {
  return (await pipe([c]))[0] as T;
}

/** HGETALL answers a flat [field, value, …] list. */
export function pairs(v: Val): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(v)) for (let i = 0; i + 1 < v.length; i += 2) out[String(v[i])] = String(v[i + 1]);
  else if (v && typeof v === "object") Object.assign(out, v);
  return out;
}

/** Test helper: forget everything held in memory. */
export function resetMemory() {
  mem.clear();
}
