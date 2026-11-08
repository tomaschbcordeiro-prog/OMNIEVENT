import { ensureFresh, cityStats, dataReady } from "@/lib/store";
import { CITIES } from "@/lib/destinations";
import { handler, ok } from "@/lib/api";

export const dynamic = "force-dynamic";
// A new server's loading keeps going after the answer (after()) for up to this many seconds:
// without it the platform's default limit stopped that loading within seconds.
export const maxDuration = 300;

/** GET /api/cities — cities with events on, busiest first: id, name, country and how many. */
export const GET = handler(async () => {
  await ensureFresh();
  const stats = cityStats();
  const cities = CITIES.map((c) => ({ id: c.id, name: c.name, country: c.country ?? "", n: stats[c.id]?.total ?? 0 }))
    .filter((c) => c.n >= 8)
    .sort((a, b) => b.n - a.n);
  return ok({ cities }, { maxAge: 600, swr: 3600, partial: !dataReady() });
});
