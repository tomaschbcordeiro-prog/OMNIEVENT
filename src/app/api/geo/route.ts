import { NextRequest } from "next/server";
import { z } from "zod";
import { ensureFresh, clusterEvents } from "@/lib/store";
import { parseFilterParams } from "@/lib/search/params";
import { handler, ok, validationError, rateLimit, clientKey, apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

const viewSchema = z.object({
  vlat: z.coerce.number().min(-90).max(90).optional(),
  vlng: z.coerce.number().min(-180).max(180).optional(),
  vr: z.coerce.number().min(1).max(20100).optional(),
  cell: z.coerce.number().min(0).max(30).default(8),
  /** Map zoom, used to merge groups whose markers would overlap on screen. */
  z: z.coerce.number().min(0).max(24).optional(),
});

/**
 * GET /api/geo — viewport-aware clusters for the globe / map.
 * Filter params as /api/events, plus vlat/vlng/vr (visible centre & radius km), cell (degrees; 0 = venue level)
 * and z (zoom, to merge groups that would overlap on screen).
 */
export const GET = handler(async (req: NextRequest) => {
  if (!rateLimit(`geo:${clientKey(req)}`, 300)) return apiError(429, "rate_limited", "Too many requests.");
  const sp = req.nextUrl.searchParams;
  const parsed = parseFilterParams(new URLSearchParams([...sp].filter(([k]) => !["vlat", "vlng", "vr", "cell", "z"].includes(k))));
  if (!parsed.ok) return validationError(parsed.error);
  const v = viewSchema.safeParse(Object.fromEntries([...sp].filter(([k]) => ["vlat", "vlng", "vr", "cell", "z"].includes(k))));
  if (!v.success) return validationError(v.error);
  await ensureFresh();
  // Markers are ~36 px wide; groups closer than 44 px on screen are merged.
  const mergeDeg = v.data.z != null ? (44 * 360) / (512 * 2 ** v.data.z) : 0;
  const res = clusterEvents(parsed.filters, { lat: v.data.vlat, lng: v.data.vlng, radiusKm: v.data.vr, cellDeg: v.data.cell, mergeDeg });
  return ok(res, { maxAge: 30 });
});
