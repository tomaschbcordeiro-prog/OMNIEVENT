import { ensureFresh } from "@/lib/store";
import { handler, ok } from "@/lib/api";

// Long crawls (Ticketmaster, SeatGeek…) keep running after the answer, up to this many seconds.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/tick — starts whatever sources are due, as any visitor's request would. Called every
 * half hour by Vercel Cron (vercel.json), so the catalogue keeps refreshing on quiet nights too.
 * It only reads sources that are due, so calling it more often changes nothing.
 */
export const GET = handler(async () => {
  await ensureFresh();
  return ok({ ok: true, at: new Date().toISOString() });
});
