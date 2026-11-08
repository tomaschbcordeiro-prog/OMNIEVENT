import { ensureFresh } from "@/lib/store";
import { handler, ok } from "@/lib/api";

// Long crawls and the biggest catalogues keep running after the answer, up to this many
// seconds (the most Vercel allows).
export const maxDuration = 800;
export const dynamic = "force-dynamic";

/**
 * GET /api/tick — starts whatever sources are due, including the biggest catalogues that a
 * visitor's request leaves to it (they take longer than a request may run). Called every
 * half hour by Vercel Cron (vercel.json), so the catalogue keeps refreshing on quiet nights too.
 * It only reads sources that are due, so calling it more often changes nothing.
 */
export const GET = handler(async () => {
  await ensureFresh({ heavy: true });
  return ok({ ok: true, at: new Date().toISOString() });
});
