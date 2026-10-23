import { NextRequest } from "next/server";
import { z } from "zod";
import { reverseGeocode, geocodeError, GEOCODER } from "@/lib/geocode";
import { handler, ok, validationError, rateLimit, clientKey, apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

const schema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  lang: z.string().regex(/^[a-z]{2}$/).optional(),
});

/** GET /api/geocode/reverse?lat&lng — what is at this point (address → city → country). */
export const GET = handler(async (req: NextRequest) => {
  if (!rateLimit(`rgeocode:${clientKey(req)}`, 40)) return apiError(429, "rate_limited", "Too many lookups. Wait a moment and try again.");
  const p = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success) return validationError(p.error);
  try {
    return ok({ place: await reverseGeocode(p.data.lat, p.data.lng, p.data.lang), provider: GEOCODER }, { maxAge: 3600 });
  } catch (err) {
    geocodeError(err);
    return apiError(502, "geocoder_unavailable", "Location lookup is temporarily unavailable.");
  }
});
