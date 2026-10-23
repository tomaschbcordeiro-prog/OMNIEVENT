import { NextRequest } from "next/server";
import { z } from "zod";
import { geocode, geocodeError, GEOCODER } from "@/lib/geocode";
import { handler, ok, validationError, rateLimit, clientKey, apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

const schema = z.object({
  q: z.string().trim().min(2).max(160),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().int().min(1).max(10).optional(),
  lang: z.string().regex(/^[a-z]{2}$/).optional(),
});

/** GET /api/geocode?q=… — places, addresses, streets, postcodes, landmarks or "lat, lng" → coordinates. */
export const GET = handler(async (req: NextRequest) => {
  if (!rateLimit(`geocode:${clientKey(req)}`, 60)) return apiError(429, "rate_limited", "Too many place searches. Wait a moment and try again.");
  const p = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success) return validationError(p.error);
  try {
    const results = await geocode(p.data.q, p.data);
    return ok({ results, provider: GEOCODER }, { maxAge: 3600 });
  } catch (err) {
    geocodeError(err);
    return apiError(502, "geocoder_unavailable", "Place search is temporarily unavailable.");
  }
});
