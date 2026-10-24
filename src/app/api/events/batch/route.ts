import { NextRequest } from "next/server";
import { z } from "zod";
import { ensureFresh, getCards } from "@/lib/store";
import { handler, ok, validationError } from "@/lib/api";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

export const dynamic = "force-dynamic";

const schema = z.object({ ids: z.string().max(8000).transform((s) => s.split(",").filter(Boolean).slice(0, 200)) });

/** GET /api/events/batch?ids=a,b,c — cards for saved items / itineraries (missing ids are reported). */
export const GET = handler(async (req: NextRequest) => {
  const p = schema.safeParse({ ids: req.nextUrl.searchParams.get("ids") ?? "" });
  if (!p.success) return validationError(p.error);
  await ensureFresh();
  const items = getCards(p.data.ids);
  const found = new Set(items.map((i) => i.id));
  return ok({ items, missing: p.data.ids.filter((id) => !found.has(id)) });
});
