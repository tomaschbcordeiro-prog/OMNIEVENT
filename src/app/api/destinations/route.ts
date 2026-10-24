import { ensureFresh, cityStats } from "@/lib/store";
import { ALL_DESTINATIONS } from "@/lib/destinations";
import { handler, ok } from "@/lib/api";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

export const dynamic = "force-dynamic";

/** GET /api/destinations — continents, countries and cities with loaded event counts. */
export const GET = handler(async () => {
  await ensureFresh();
  const stats = cityStats();
  return ok({ destinations: ALL_DESTINATIONS.map((d) => ({ ...d, stats: stats[d.id] })) }, { maxAge: 120 });
});
