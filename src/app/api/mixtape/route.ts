import { NextRequest } from "next/server";
import { z } from "zod";
import { ensureFresh, mixtapePool, dataReady } from "@/lib/store";
import { getDestination } from "@/lib/destinations";
import { forecast } from "@/lib/weather";
import { handler, ok, validationError, rateLimit, clientKey, apiError } from "@/lib/api";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

export const dynamic = "force-dynamic";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD").refine((s) => Number.isFinite(Date.parse(`${s}T00:00:00Z`)), "not a date");
const schema = z
  .object({
    city: z.string().max(60).regex(/^[a-z0-9-]+$/),
    from: ymd,
    to: ymd,
    /** A shared tape's events, kept in the pool whatever their rank. */
    include: z
      .string()
      .max(2000)
      .optional()
      .transform((s) => (s ? s.split(",").filter((x) => /^[\w:.-]{1,160}$/.test(x)).slice(0, 12) : [])),
  })
  .refine((v) => v.from <= v.to, { message: "`from` must be before `to`", path: ["from"] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 8 * 864e5, { message: "At most 8 days.", path: ["to"] });

/**
 * GET /api/mixtape?city=lisbon&from=YYYY-MM-DD&to=YYYY-MM-DD[&include=id,id] — what a Mixtape in that city on
 * those (local) dates can be made of: events with their performances, or opening windows,
 * in that time. The tape itself is planned in the browser, so every shuffle is instant.
 */
export const GET = handler(async (req: NextRequest) => {
  if (!rateLimit(`mixtape:${clientKey(req)}`, 60)) return apiError(429, "rate_limited", "Too many requests.");
  const sp = req.nextUrl.searchParams;
  const v = schema.safeParse({ city: sp.get("city") ?? "", from: sp.get("from") ?? "", to: sp.get("to") ?? "", include: sp.get("include") ?? undefined });
  if (!v.success) return validationError(v.error);
  const d = getDestination(v.data.city);
  if (!d || d.kind !== "city") return apiError(404, "not_found", "That city isn't one we know.");
  await ensureFresh();
  const { items, total } = mixtapePool(d.id, v.data.from, v.data.to, 450, new Set(v.data.include));
  // The forecast for each day of the tape (when it answers in time).
  const wx = await forecast(d.lat, d.lng, 10);
  const weather = (wx?.days ?? []).filter((w) => w.date >= v.data.from && w.date <= v.data.to);
  return ok(
    { city: { id: d.id, name: d.name, country: d.country, tz: d.timeZone, currency: d.currency ?? "EUR", lat: d.lat, lng: d.lng }, from: v.data.from, to: v.data.to, items, total, weather },
    { maxAge: 300, swr: 1800, partial: !dataReady() },
  );
});
