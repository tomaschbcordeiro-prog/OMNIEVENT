import { ensureFresh } from "@/lib/store";
import { apiError, clientKey, handler, hasBearer, ok, rateLimit } from "@/lib/api";

// Long crawls and the biggest catalogues keep running after the answer, up to this many
// seconds (the most Vercel's free plan allows).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/tick — starts whatever sources are due, including the biggest catalogues that a
 * visitor's request leaves to it (they take longer than a request may run). Called once a day
 * by Vercel Cron (vercel.json: the free plan runs scheduled jobs daily at most), so the catalogue
 * keeps refreshing on quiet days too.
 * It only reads sources that are due, so calling it more often changes nothing.
 *
 * With CRON_SECRET set (Vercel Cron then sends it), only the scheduler may call it. Without
 * it, anyone may, but rarely: a few times an hour per address, and a dozen in all.
 */
export const GET = handler(async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (!hasBearer(req, secret)) return apiError(401, "unauthorized", "Invalid credentials.");
  } else if (!rateLimit(`tick:${clientKey(req)}`, 3, 3_600_000) || !rateLimit("tick:all", 12, 3_600_000)) {
    return apiError(429, "rate_limited", "Too many requests. Try again later.");
  }
  await ensureFresh({ heavy: true });
  return ok({ ok: true, at: new Date().toISOString() });
});
