import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, ok, validationError, rateLimit, clientKey, apiError } from "@/lib/api";
import { photoFor, type WikiPage } from "@/lib/sights";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

const UA = "OMNIEVENT/1.0 (event discovery; https://omnievent.vercel.app)";
const WEEK = 7 * 86_400_000;
const cache = new Map<string, { at: number; photo: ReturnType<typeof photoFor> }>();

/** GET /api/places/photo?name&lat&lng — a picture of a place on a trip (its Wikipedia page's), if it has one. */
export const GET = handler(async (req: NextRequest) => {
  if (!rateLimit(`photo:${clientKey(req)}`, 60)) return apiError(429, "rate_limited", "Too many lookups. Wait a moment and try again.");
  const p = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success) return validationError(p.error);
  const key = `${p.data.name.toLowerCase()}|${p.data.lat.toFixed(3)},${p.data.lng.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < WEEK) return ok({ photo: hit.photo }, { maxAge: 604_800 });
  const u = new URL("https://en.wikipedia.org/w/api.php");
  for (const [k, v] of Object.entries({ action: "query", format: "json", generator: "geosearch", ggscoord: `${p.data.lat}|${p.data.lng}`, ggsradius: "600", ggslimit: "25", prop: "pageimages", piprop: "thumbnail", pithumbsize: "640", pilimit: "25" })) u.searchParams.set(k, v);
  try {
    const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(6000), next: { revalidate: 604_800 } });
    if (!res.ok) throw new Error(`wikipedia HTTP ${res.status}`);
    const j = (await res.json()) as { query?: { pages?: Record<string, WikiPage> } };
    const photo = photoFor(Object.values(j.query?.pages ?? {}), p.data.name);
    cache.set(key, { at: Date.now(), photo });
    if (cache.size > 2000) cache.delete(cache.keys().next().value!);
    return ok({ photo }, { maxAge: 604_800 });
  } catch (err) {
    log("warn", "photo lookup failed", { err: String(err) });
    return ok({ photo: null }, { maxAge: 60 });
  }
});
