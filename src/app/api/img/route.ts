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
const original = (u: string) => new Response(null, { status: 302, headers: { Location: u, "Cache-Control": "public, max-age=3600, s-maxage=3600" } });

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
  if (!rateLimit(`img:${clientKey(req)}`, 400)) return original(url.href);

  try {
    // Only public addresses on the internet.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => privateAddress(a.address))) return new Response("Not allowed", { status: 403 });

    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "OMNIEVENT image preview", Accept: "image/avif,image/webp,image/*" } });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/") || type.includes("svg") || Number(res.headers.get("content-length") ?? 0) > MAX_BYTES || !res.body) return original(url.href);
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
        return original(url.href);
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
  } catch {
    return original(url.href);
  }
}
