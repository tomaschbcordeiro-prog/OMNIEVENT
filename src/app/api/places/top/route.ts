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

async function wiki(params: Record<string, string>): Promise<{ query?: { pages?: Record<string, WikiPage> } }> {
  const u = new URL("https://en.wikipedia.org/w/api.php");
  for (const [k, v] of Object.entries({ action: "query", format: "json", ...params })) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8000), next: { revalidate: 86_400 } });
  if (!res.ok) throw new Error(`wikipedia HTTP ${res.status}`);
  return res.json();
}

/** GET /api/places/top?lat&lng — a city's best-known sights (from Wikipedia), for planning a trip. */
export const GET = handler(async (req: NextRequest) => {
  if (!rateLimit(`sights:${clientKey(req)}`, 30)) return apiError(429, "rate_limited", "Too many lookups. Wait a moment and try again.");
  const p = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success) return validationError(p.error);
  const key = `${p.data.lat.toFixed(2)},${p.data.lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY) return ok({ sights: hit.sights }, { maxAge: 86_400 });
  try {
    // What's round there (with what each is and how much is written about it), then the pictures
    // of the best ones only: Wikipedia gives pictures for 50 pages at most a call.
    // Two ways round: the nearest pages (a city's centre), and the most-read ones within 10 km
    // (the landmarks a bit out, like Belém in Lisbon).
    const props = { prop: "description|info|coordinates", colimit: "max" };
    const [nearest, known] = await Promise.allSettled([
      wiki({ generator: "geosearch", ggscoord: `${p.data.lat}|${p.data.lng}`, ggsradius: "10000", ggslimit: "300", ...props }),
      wiki({ generator: "search", gsrsearch: `nearcoord:10km,${p.data.lat},${p.data.lng}`, gsrlimit: "100", gsrnamespace: "0", ...props }),
    ]);
    if (nearest.status === "rejected" && known.status === "rejected") throw nearest.reason;
    const pages = new Map<number, WikiPage>();
    for (const r of [nearest, known]) if (r.status === "fulfilled") for (const x of Object.values(r.value.query?.pages ?? {})) if (!pages.has(x.pageid) || !pages.get(x.pageid)!.coordinates) pages.set(x.pageid, x);
    const sights = sightsFromWikipedia([...pages.values()]);
    if (sights.length) {
      const pics = await wiki({ pageids: sights.map((x) => x.id.slice(2)).join("|"), prop: "pageimages", piprop: "thumbnail", pithumbsize: "400", pilimit: "50" }).catch(() => null);
      const by = new Map(Object.values(pics?.query?.pages ?? {}).map((x) => [`wp${x.pageid}`, x.thumbnail?.source]));
      for (const x of sights) if (by.get(x.id)) x.image = by.get(x.id);
    }
    cache.set(key, { at: Date.now(), sights });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return ok({ sights }, { maxAge: 86_400 });
  } catch (err) {
    log("warn", "sights lookup failed", { err: String(err) });
    return ok({ sights: [] as Sight[] }, { maxAge: 60 });
  }
});
