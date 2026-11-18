import { clientKey, rateLimit } from "@/lib/api";
import { THUMB_WIDTHS } from "@/lib/thumb";
import { loadingNow } from "@/lib/store";
import { CONTACT_URL } from "@/lib/site";
import { obviouslyInside, publicAddresses, safeGet, type SafeResponse } from "@/lib/safe-fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const MAX_BYTES = 12 * 1024 * 1024;

/** The original picture, when ours can't be made: the browser loads it as it would have. */
const original = (u: string, why: string) =>
  new Response(null, {
    status: 302,
    // A passing reason (busy, too many requests) isn't kept: the next look may get the small one.
    // Kept apart from other kinds of request (Vary), so a stored hop is only ever reused for a picture.
    headers: { Location: u, "Cache-Control": why === "busy" || why === "rate" ? "no-store" : "public, max-age=3600, s-maxage=3600", "X-Img-Fallback": why, Vary: "Sec-Fetch-Dest" },
  });

let inFlight = 0;

/** Only public addresses on the internet. */
const publicHost = (url: URL) => publicAddresses(url.hostname).then(() => true, () => false);

/**
 * Sites that didn't answer us lately (some refuse cloud servers): their pictures go straight to
 * the original for an hour instead of waiting on them every time.
 */
const unreachable = new Map<string, number>();
const HOST_PAUSE_MS = 3600000;

/** Fetches a picture, following up to three redirects, each to a public https address. */
async function fetchImage(start: URL): Promise<SafeResponse | string> {
  let url = start;
  for (let hop = 0; hop < 4; hop++) {
    const res = await safeGet(url, { timeoutMs: 5000, headers: { "User-Agent": `Mozilla/5.0 (compatible; Mundivi image preview; +${CONTACT_URL})`, Accept: "image/avif,image/webp,image/*;q=0.9,*/*;q=0.5" } });
    if (res.status >= 300 && res.status < 400) {
      res.cancel();
      const next = res.headers.location;
      if (!next) return "redirect-without-location";
      url = new URL(next, url);
      if (url.protocol !== "https:") return "redirect-not-https";
      continue;
    }
    return res;
  }
  return "too-many-redirects";
}

/**
 * GET /api/img?u=<https image>&w=<width> — an event picture at the size it's shown (lists show
 * 56 px thumbnails of pictures that can weigh megabytes), as WebP. Each size of each picture
 * is made once and then served from the CDN. Anything unusual falls back to the original.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const u = sp.get("u") ?? "";
  const w = Number(sp.get("w"));
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return new Response("Bad image address", { status: 400 });
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !THUMB_WIDTHS.includes(w as (typeof THUMB_WIDTHS)[number])) return new Response("Bad image request", { status: 400 });
  // Pictures only: opened as a page (a link someone was sent), this address leads nowhere, so it
  // can't be used to send people on to another site. Browsers without the header are trusted.
  const dest = req.headers.get("sec-fetch-dest");
  if (dest && dest !== "image") return new Response("This address only serves pictures.", { status: 400, headers: { "Cache-Control": "no-store", Vary: "Sec-Fetch-Dest" } });
  // Somewhere inside a network: neither fetched nor handed back to the browser.
  if (obviouslyInside(url)) return new Response("Not allowed", { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!rateLimit(`img:${clientKey(req)}`, 400)) return original(url.href, "rate");

  if ((unreachable.get(url.hostname) ?? 0) > Date.now()) return original(url.href, "host-paused");
  // A server still loading its catalogue keeps its processor for that: pictures as they are.
  if (loadingNow()) return original(url.href, "busy");
  // Two pictures at a time per server: downloads look up names on Node's small pool of worker
  // threads, which the rest of the server needs too. Beyond that, the original picture.
  if (inFlight >= 2) return original(url.href, "busy");
  inFlight++;
  try {
    if (!(await publicHost(url))) return new Response("Not allowed", { status: 403 });
    const res = await fetchImage(url);
    if (typeof res === "string") return original(url.href, res);
    const type = String(res.headers["content-type"] ?? "");
    if (res.status < 200 || res.status >= 300) {
      res.cancel();
      return original(url.href, `status-${res.status}`);
    }
    if (!type.startsWith("image/") || type.includes("svg")) {
      res.cancel();
      return original(url.href, `type-${type.split(";")[0].slice(0, 40)}`);
    }
    if (Number(res.headers["content-length"] ?? 0) > MAX_BYTES) {
      res.cancel();
      return original(url.href, "size");
    }
    // Read with a cap, whatever the server claimed.
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.byteLength;
      if (size > MAX_BYTES) {
        res.cancel();
        return original(url.href, "size");
      }
      chunks.push(chunk);
    }
    const { default: sharp } = await import("sharp");
    const out = await sharp(Buffer.concat(chunks), { limitInputPixels: 50_000_000, animated: false })
      .rotate()
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: w <= 200 ? 70 : 78 })
      .toBuffer();
    return new Response(new Uint8Array(out), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=604800", "X-Content-Type-Options": "nosniff" },
    });
  } catch (err) {
    const e = err as Error & { code?: string; cause?: { code?: string } };
    // Somewhere it may not go (a redirect inside, or a name that changed its answer).
    if (e?.code === "EPRIVATE") return new Response("Not allowed", { status: 403 });
    // A site that times out or drops the connection is left alone for a while.
    if (e?.name === "TimeoutError" || e?.code || e?.cause?.code) {
      unreachable.set(url.hostname, Date.now() + HOST_PAUSE_MS);
      if (unreachable.size > 500) unreachable.delete(unreachable.keys().next().value!);
    }
    return original(url.href, `error-${String(e?.code ?? e?.cause?.code ?? e?.name ?? "unknown").slice(0, 40)}`);
  } finally {
    inFlight--;
  }
}
