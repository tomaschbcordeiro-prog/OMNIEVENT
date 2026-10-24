import { CITIES } from "../destinations";
import { haversineKm } from "../geo";
import { zonedToUtc } from "../time";
import { ProviderError, type SyncContext } from "./types";

/** Helpers shared by the provider adapters. */

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Id of the nearest known city within 60 km, so events show up on city pages. */
export function nearestCityId(lat: number, lng: number): string | undefined {
  let best: { id: string; d: number } | undefined;
  for (const c of CITIES) {
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (!best || d < best.d) best = { id: c.id, d };
  }
  return best && best.d < 60 ? best.id : undefined;
}

/** Cities from our destination list in the given countries. */
export const citiesIn = (countryCodes: string[]) => CITIES.filter((c) => !!c.countryCode && countryCodes.includes(c.countryCode));

/**
 * GET a JSON document with retries on rate limits, timeouts and 5xx errors.
 * `revalidate` (seconds) stores the response in the platform data cache; pass 0
 * for responses too large to cache.
 */
export async function fetchJson(
  provider: string,
  url: string | URL,
  ctx: Pick<SyncContext, "signal" | "log">,
  { revalidate = 3600, timeoutMs = 30000, attempts = 3, headers }: { revalidate?: number; timeoutMs?: number; attempts?: number; headers?: Record<string, string> } = {},
): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    try {
      const init = (revalidate > 0 ? { signal, headers, next: { revalidate } } : { signal, headers, cache: "no-store" }) as RequestInit;
      const res = await fetch(url, init);
      if (res.status === 429) {
        lastErr = new ProviderError(provider, "rate limited", 429, true);
        const wait = Number(res.headers.get("retry-after") ?? 2) * 1000 * (attempt + 1);
        ctx.log(`${provider} rate limited, backing off`, { wait });
        await sleep(wait);
        continue;
      }
      if (res.status >= 500) {
        lastErr = new ProviderError(provider, `HTTP ${res.status}`, res.status);
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status}`, res.status);
      return await res.json();
    } catch (err) {
      if (err instanceof ProviderError && !err.rateLimited && (err.status ?? 0) < 500) throw err;
      if (ctx.signal?.aborted) throw err;
      lastErr = err;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new ProviderError(provider, String(lastErr));
}

/**
 * "YYYY-MM-DD", "YYYY-MM-DD HH:MM[:SS]" or "YYYY-MM-DDTHH:MM" read as wall-clock
 * time in `tz`. Strings with an explicit offset or "Z" are taken as they are.
 */
export function parseLocal(s: string | undefined, tz: string): number | undefined {
  if (!s) return undefined;
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(s.trim())) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : undefined;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return undefined;
  return zonedToUtc(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, tz);
}

/** First amount in a free-text price such as "3 euros", "Desde 18 €" or "£10.00". */
export function parseAmount(s: string | undefined | null): number | undefined {
  if (!s) return undefined;
  const m = s.replace(/\s/g, " ").match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!m) return undefined;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/** Strip HTML tags and collapse whitespace. */
export function plainText(html: string | undefined | null): string | undefined {
  if (!html) return undefined;
  const t = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return t || undefined;
}

/** Stable hue for generated posters. */
export function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Comma-separated env list, upper-cased, or the fallback. */
export function envList(name: string, fallback: string[]): string[] {
  const v = process.env[name]?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return v?.length ? v : fallback;
}
