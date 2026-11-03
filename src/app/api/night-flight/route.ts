import { NextRequest } from "next/server";
import { z } from "zod";
import { ensureFresh, nightFlight, dataReady } from "@/lib/store";
import { GROUPS } from "@/lib/categories";
import { handler, ok, validationError, rateLimit, clientKey, apiError } from "@/lib/api";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

export const dynamic = "force-dynamic";

const groupSlugs = new Set(GROUPS.map((g) => g.slug));
const schema = z.object({
  n: z.coerce.number().int().min(1).max(16).default(10),
  cat: z
    .string()
    .max(200)
    .optional()
    .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []))
    .refine((a) => a.length <= 6 && a.every((g) => groupSlugs.has(g)), "Unknown category group."),
});

/**
 * GET /api/night-flight — tonight's route round the planet: timed events starting in the
 * next day in their local evening, one per region where possible, ordered east to west as
 * night falls. Params: n (stops, up to 16), cat (comma-separated category groups).
 */
export const GET = handler(async (req: NextRequest) => {
  if (!rateLimit(`flight:${clientKey(req)}`, 30)) return apiError(429, "rate_limited", "Too many requests.");
  const sp = req.nextUrl.searchParams;
  const v = schema.safeParse({ n: sp.get("n") ?? undefined, cat: sp.get("cat") ?? undefined });
  if (!v.success) return validationError(v.error);
  await ensureFresh();
  // A fresh route each time: never cached.
  return ok({ items: nightFlight({ n: v.data.n, groups: v.data.cat }) }, { partial: !dataReady() });
});
