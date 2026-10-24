import { NextRequest } from "next/server";
import { z } from "zod";
import tzlookup from "@photostructure/tz-lookup";
import { handler, ok, validationError } from "@/lib/api";
import { tzLabel, todayIn, isValidTimeZone } from "@/lib/time";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

const schema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * GET /api/timezone?lat&lng[&date] — IANA time zone at a point (offline boundary data, works
 * at sea using nautical zones), with its label on the given date (offsets change with DST).
 */
export const GET = handler(async (req: NextRequest) => {
  const p = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success) return validationError(p.error);
  let tz = "UTC";
  try {
    tz = tzlookup(p.data.lat, p.data.lng);
  } catch {
    // outside any zone polygon: keep UTC
  }
  if (!isValidTimeZone(tz)) tz = "UTC";
  const at = p.data.date ? new Date(`${p.data.date}T12:00:00Z`) : new Date();
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short" }).format(new Date());
  return ok({ timeZone: tz, label: tzLabel(tz, at), today: todayIn(tz), localNow: local }, { maxAge: 86400 });
});
