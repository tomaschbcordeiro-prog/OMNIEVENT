import { NextRequest } from "next/server";
import { z } from "zod";
import { ensureFresh, sampleEvents, dataReady } from "@/lib/store";
import { parseFilterParams } from "@/lib/search/params";
import { handler, ok, validationError, rateLimit, clientKey, apiError } from "@/lib/api";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

export const dynamic = "force-dynamic";

const schema = z.object({ n: z.coerce.number().int().min(1).max(24).default(12) });

/**
 * GET /api/spin — a random handful of events for "Spin the globe", each in a different city
 * where possible. Filter params as /api/events, plus n (how many, up to 24).
 */
export const GET = handler(async (req: NextRequest) => {
  if (!rateLimit(`spin:${clientKey(req)}`, 60)) return apiError(429, "rate_limited", "Too many requests.");
  const sp = req.nextUrl.searchParams;
  const parsed = parseFilterParams(new URLSearchParams([...sp].filter(([k]) => k !== "n")));
  if (!parsed.ok) return validationError(parsed.error);
  const v = schema.safeParse({ n: sp.get("n") ?? undefined });
  if (!v.success) return validationError(v.error);
  await ensureFresh();
  // Random on purpose: never cached, so every spin can land somewhere new.
  return ok({ items: sampleEvents(parsed.filters, v.data.n) }, { partial: !dataReady() });
});
