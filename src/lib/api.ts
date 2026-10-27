import "server-only";
import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { log } from "./log";

/** Predictable error envelope: { error: { code, message, details? } } */
export function apiError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export function validationError(err: ZodError) {
  return apiError(400, "invalid_params", "One or more parameters are invalid.", err.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
}

/**
 * JSON answer. With `maxAge`, the CDN may serve it to everyone for that long (and while it
 * refreshes); `partial` answers (a server still loading its data) are never cached.
 */
export function ok<T>(data: T, init?: { maxAge?: number; swr?: number; partial?: boolean }) {
  const res = NextResponse.json(data);
  if (init?.partial) res.headers.set("Cache-Control", "no-store");
  else if (init?.maxAge != null)
    res.headers.set("Cache-Control", `public, s-maxage=${init.maxAge}, stale-while-revalidate=${init.swr ?? init.maxAge * 5}`);
  return res;
}

/** Wrap a handler so unexpected errors become a logged 500 with a stable shape. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      log("error", "unhandled api error", { err: String(err), stack: err instanceof Error ? err.stack : undefined });
      return apiError(500, "internal_error", "Something went wrong. Please try again.");
    }
  };
}

/** Naive fixed-window rate limiter per key (per instance). Use Redis/Upstash in production. */
const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, limit = 120, windowMs = 60000): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    if (buckets.size > 10000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return true;
  }
  b.n++;
  return b.n <= limit;
}

export function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}
