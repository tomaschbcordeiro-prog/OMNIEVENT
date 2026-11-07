import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureFresh } from "@/lib/store";
import { getHere, hereCityById, nearestCity } from "@/lib/here";
import { HERE_COOKIE, hereCookieValue, type Here } from "@/lib/here-shared";
import { handler, validationError, rateLimit, clientKey, apiError, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

const noStore = (body: unknown, init?: ResponseInit) => {
  const res = NextResponse.json(body, init);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
};

/** GET /api/here — the city this visitor's pages open on (their choice, else their connection's city). */
export const GET = handler(async () => {
  await ensureFresh();
  return noStore({ here: await getHere() });
});

const body = z.union([
  z.object({ city: z.string().max(60).regex(/^[a-z0-9-]+$/) }),
  z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  z.object({ any: z.literal(true) }),
  z.object({ reset: z.literal(true) }),
]);

/**
 * POST /api/here — change it: { city } to choose one, { lat, lng } for the device's location
 * (the nearest city with events), { any: true } for the whole planet, { reset: true } to go
 * back to the connection's city. Remembered in a cookie for a year.
 */
export const POST = handler(async (req: NextRequest) => {
  if (!rateLimit(`here:${clientKey(req)}`, 30)) return apiError(429, "rate_limited", "Too many requests.");
  const raw = await readJson(req, 2048);
  if (raw instanceof Response) return raw;
  const v = body.safeParse(raw);
  if (!v.success) return validationError(v.error);
  await ensureFresh();
  const b = v.data;
  let here: Here;
  let cookie: string | null;
  if ("any" in b) {
    here = { city: null, source: "any" };
    cookie = hereCookieValue("any");
  } else if ("reset" in b) {
    cookie = null;
    here = { city: null, source: "none" };
  } else if ("city" in b) {
    const city = hereCityById(b.city);
    if (!city) return apiError(404, "not_found", "That city isn't one we know.");
    here = { city, source: "chosen" };
    cookie = hereCookieValue({ id: city.id, source: "chosen" });
  } else {
    // Only the nearest city is kept, never the exact point.
    const city = nearestCity(b.lat, b.lng, 120);
    if (!city) return apiError(404, "no_city_near", "We don't list events near you yet.");
    here = { city, source: "gps" };
    cookie = hereCookieValue({ id: city.id, source: "gps" });
  }
  const res = noStore({ here });
  if (cookie) res.cookies.set(HERE_COOKIE, cookie, { path: "/", maxAge: 365 * 86400, sameSite: "lax", httpOnly: true, secure: req.nextUrl.protocol === "https:" });
  else res.cookies.delete(HERE_COOKIE);
  return res;
});
