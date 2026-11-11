import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, ok, validationError, rateLimit, clientKey, apiError } from "@/lib/api";
import { sightsFromWikipedia, type Sight, type WikiPage } from "@/lib/sights";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const schema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

const UA = "OMNIEVENT/1.0 (event discovery; https://omnievent.vercel.app)";
const cache = new Map<string, { at: number; sights: Sight[] }>();
const DAY = 86_400_000;

/** GET /api/places/top?lat&lng — a city's best-known sights (from Wikipedia), for planning a trip. */
export const GET = handler(async (req: NextRequest) => {
  if (!rateLimit(`sights:${clientKey(req)}`, 30)) return apiError(429, "rate_limited", "Too many lookups. Wait a moment and try again.");
  const p = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success) return validationError(p.error);
  const key = `${p.data.lat.toFixed(2)},${p.data.lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY) return ok({ sights: hit.sights }, { maxAge: 86_400 });
  const u = new URL("https://en.wikipedia.org/w/api.php");
  for (const [k, v] of Object.entries({ action: "query", format: "json", generator: "geosearch", ggscoord: `${p.data.lat}|${p.data.lng}`, ggsradius: "10000", ggslimit: "200", prop: "pageimages|description|info|coordinates", piprop: "thumbnail", pithumbsize: "400", pilimit: "200" })) u.searchParams.set(k, v);
  try {
    const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8000), next: { revalidate: 86_400 } });
    if (!res.ok) throw new Error(`wikipedia HTTP ${res.status}`);
    const j = (await res.json()) as { query?: { pages?: Record<string, WikiPage> } };
    const sights = sightsFromWikipedia(Object.values(j.query?.pages ?? {}));
    cache.set(key, { at: Date.now(), sights });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return ok({ sights }, { maxAge: 86_400 });
  } catch (err) {
    log("warn", "sights lookup failed", { err: String(err) });
    return ok({ sights: [] as Sight[] }, { maxAge: 60 });
  }
});
