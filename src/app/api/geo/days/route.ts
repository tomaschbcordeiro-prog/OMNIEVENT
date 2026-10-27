import { NextRequest } from "next/server";
import { z } from "zod";
import { ensureFresh, dayCounts, dataReady } from "@/lib/store";
import { parseFilterParams } from "@/lib/search/params";
import { handler, ok, validationError, rateLimit, clientKey, apiError } from "@/lib/api";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

export const dynamic = "force-dynamic";

const OWN = ["vlat", "vlng", "vr", "start", "n"];
const schema = z.object({
  vlat: z.coerce.number().min(-90).max(90).optional(),
  vlng: z.coerce.number().min(-180).max(180).optional(),
  vr: z.coerce.number().min(1).max(20100).optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  n: z.coerce.number().int().min(1).max(31).default(14),
});

/**
 * GET /api/geo/days — how many events match on each day, for the globe's timeline.
 * Filter params as /api/events (their dates are ignored), plus vlat/vlng/vr (the visible
 * area), start (first day, YYYY-MM-DD) and n (days, up to 31).
 */
export const GET = handler(async (req: NextRequest) => {
  if (!rateLimit(`geo-days:${clientKey(req)}`, 120)) return apiError(429, "rate_limited", "Too many requests.");
  const sp = req.nextUrl.searchParams;
  const parsed = parseFilterParams(new URLSearchParams([...sp].filter(([k]) => !OWN.includes(k))));
  if (!parsed.ok) return validationError(parsed.error);
  const v = schema.safeParse(Object.fromEntries([...sp].filter(([k]) => OWN.includes(k))));
  if (!v.success) return validationError(v.error);
  await ensureFresh();
  const counts = dayCounts(parsed.filters, { lat: v.data.vlat, lng: v.data.vlng, radiusKm: v.data.vr }, v.data.start, v.data.n);
  return ok({ start: v.data.start, counts }, { maxAge: 120, swr: 1800, partial: !dataReady() });
});
