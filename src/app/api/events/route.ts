import { NextRequest } from "next/server";
import { ensureFresh, searchEvents, dataSummary } from "@/lib/store";
import { parseFilterParams } from "@/lib/search/params";
import { handler, ok, validationError, rateLimit, clientKey, apiError } from "@/lib/api";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

export const dynamic = "force-dynamic";

/** GET /api/events — paginated, filtered event search. */
export const GET = handler(async (req: NextRequest) => {
  if (!rateLimit(`events:${clientKey(req)}`, 240)) return apiError(429, "rate_limited", "Too many requests.");
  const parsed = parseFilterParams(req.nextUrl.searchParams);
  if (!parsed.ok) return validationError(parsed.error);
  await ensureFresh();
  const result = searchEvents(parsed.filters);
  return ok({ ...result, data: dataSummary() }, { maxAge: 60, swr: 1800 });
});
