import { NextRequest } from "next/server";
import { ensureFresh, searchEvents, dataSummary, dataReady, eventCount, waitFor } from "@/lib/store";
import { parseFilterParams } from "@/lib/search/params";
import { handler, ok, validationError, rateLimit, clientKey, apiError } from "@/lib/api";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

export const dynamic = "force-dynamic";

// Answers are served from the CDN while they refresh; "on right now" answers go stale fast.
const CACHE = { maxAge: 60, swr: 1800 };
const LIVE_CACHE = { maxAge: 30, swr: 120 };

/** GET /api/events — paginated, filtered event search. */
export const GET = handler(async (req: NextRequest) => {
  if (!rateLimit(`events:${clientKey(req)}`, 240)) return apiError(429, "rate_limited", "Too many requests.");
  const parsed = parseFilterParams(req.nextUrl.searchParams);
  if (!parsed.ok) return validationError(parsed.error);
  await ensureFresh();
  // A server that has just started has its first events about two seconds in: wait for them
  // rather than answer "no events".
  await waitFor(() => (eventCount() > 0 ? true : undefined), 5000);
  const result = searchEvents(parsed.filters);
  return ok({ ...result, data: dataSummary() }, { ...(parsed.filters.live ? LIVE_CACHE : CACHE), partial: !dataReady() });
});
