import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { clientKey, rateLimit } from "@/lib/api";
import { THUMB_WIDTHS } from "@/lib/thumb";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const MAX_BYTES = 12 * 1024 * 1024;

/** Addresses on private, local or reserved networks: never fetched (no reaching inside). */
function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

/** The original picture, when ours can't be made: the browser loads it as it would have. */
const original = (u: string, why: string) => new Response(null, { status: 302, headers: { Location: u, "Cache-Control": "public, max-age=3600, s-maxage=3600", "X-Img-Fallback": why } });

/** Only public addresses on the internet. */
async function publicHost(url: URL): Promise<boolean> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  return addrs.length > 0 && !addrs.some((a) => privateAddress(a.address));
}

/**
 * Sites that didn't answer us lately (some refuse cloud servers): their pictures go straight to
 * the original for an hour instead of waiting on them every time.
 */
const unreachable = new Map<string, number>();
const HOST_PAUSE_MS = 3600000;

/** Fetches a picture, following up to three redirects, each to a public https address. */
async function fetchImage(start: URL): Promise<Response | string> {
  let url = start;
  for (let hop = 0; hop < 4; hop++) {
    if (!(await publicHost(url))) return "private";
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000), headers: { "User-Agent": "Mozilla/5.0 (compatible; OMNIEVENT image preview; +https://omnievent.vercel.app)", Accept: "image/avif,image/webp,image/*;q=0.9,*/*;q=0.5" } });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
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
  if (!rateLimit(`img:${clientKey(req)}`, 400)) return original(url.href, "rate");

  if ((unreachable.get(url.hostname) ?? 0) > Date.now()) return original(url.href, "host-paused");
  try {
    if (!(await publicHost(url))) return new Response("Not allowed", { status: 403 });
    const res = await fetchImage(url);
    if (typeof res === "string") return original(url.href, res);
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok) return original(url.href, `status-${res.status}`);
    if (!type.startsWith("image/") || type.includes("svg")) return original(url.href, `type-${type.split(";")[0].slice(0, 40)}`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES || !res.body) return original(url.href, "size");
    // Read with a cap, whatever the server claimed.
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return original(url.href, "size");
      }
      chunks.push(value);
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
    const e = err as Error & { cause?: { code?: string } };
    // A site that times out or drops the connection is left alone for a while.
    if (e?.name === "TimeoutError" || e?.cause?.code) {
      unreachable.set(url.hostname, Date.now() + HOST_PAUSE_MS);
      if (unreachable.size > 500) unreachable.delete(unreachable.keys().next().value!);
    }
    return original(url.href, `error-${String(e?.cause?.code ?? e?.name ?? "unknown").slice(0, 40)}`);
  }
}
