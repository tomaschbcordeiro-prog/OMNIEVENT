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
 * refreshes). `partial` answers (a server still loading its data) are kept only 15 seconds:
 * long enough to spare the servers a burst of identical requests, short enough to be
 * replaced by the full answer soon.
 */
export function ok<T>(data: T, init?: { maxAge?: number; swr?: number; partial?: boolean }) {
  const res = NextResponse.json(data);
  if (init?.partial && init.maxAge != null) res.headers.set("Cache-Control", "public, s-maxage=15, stale-while-revalidate=15");
  else if (init?.partial) res.headers.set("Cache-Control", "no-store");
  else if (init?.maxAge != null)
    res.headers.set("Cache-Control", `public, s-maxage=${init.maxAge}, stale-while-revalidate=${init.swr ?? init.maxAge * 5}`);
  return res;
}

/**
 * A request's JSON object, read with a size limit (the forms send a few kilobytes; anything far
 * bigger is refused before it is parsed or validated). Returns an error response instead when
 * the body is too large or isn't a JSON object.
 */
export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown> | Response> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return apiError(413, "too_large", "That's too much to send at once.");
  let text: string;
  try {
    text = await req.text();
  } catch {
    return apiError(400, "invalid_body", "Send JSON.");
  }
  if (text.length > maxBytes) return apiError(413, "too_large", "That's too much to send at once.");
  try {
    const body = JSON.parse(text) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "invalid_body", "Send a JSON object.");
    return body as Record<string, unknown>;
  } catch {
    return apiError(400, "invalid_body", "Send JSON.");
  }
}

/** Removes anything that looks like a key or token from a text shown to the public. */
export function redactSecrets(text: string): string {
  return text
    .replace(/([?&](?:apikey|api_key|key|client_id|client_secret|token|access_token|secret)=)[^&\s"')]+/gi, "$1[hidden]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 [hidden]");
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

/**
 * The caller's address, for rate limits. The host's own headers come first (Vercel sets
 * x-real-ip and overwrites x-forwarded-for), so a client can't pick its own key.
 */
export function clientKey(req: Request): string {
  return req.headers.get("x-real-ip") || req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}
