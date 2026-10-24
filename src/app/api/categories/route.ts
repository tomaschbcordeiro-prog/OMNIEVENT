import { ensureFresh, groupCounts } from "@/lib/store";
import { CATEGORIES } from "@/lib/categories";
import { handler, ok } from "@/lib/api";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

export const dynamic = "force-dynamic";

/** GET /api/categories — the category tree with counts of loaded upcoming events. */
export const GET = handler(async () => {
  await ensureFresh();
  const counts = groupCounts();
  return ok({ categories: CATEGORIES.filter((c) => c.active).map((c) => ({ ...c, count: counts[c.slug] ?? 0 })) }, { maxAge: 120 });
});
