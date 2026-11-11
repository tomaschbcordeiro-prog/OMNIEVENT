import { NextRequest } from "next/server";
import { z } from "zod";
import { townAt } from "@/lib/geocode";
import { handler, ok, validationError, rateLimit, clientKey, apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

const schema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

/** GET /api/geocode/town?lat&lng — the town or city at a point, for a trip's stop. */
export const GET = handler(async (req: NextRequest) => {
  if (!rateLimit(`town:${clientKey(req)}`, 40)) return apiError(429, "rate_limited", "Too many lookups. Wait a moment and try again.");
  const p = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success) return validationError(p.error);
  return ok({ town: await townAt(p.data.lat, p.data.lng) }, { maxAge: 3600 });
});
