import { NextRequest } from "next/server";
import { ensureFresh, getEventView } from "@/lib/store";
import { handler, ok, apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/events/:slug — full event detail with venue, participants and ticket offers. */
export const GET = handler(async (_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  await ensureFresh();
  const ev = getEventView(decodeURIComponent(slug));
  if (!ev) return apiError(404, "not_found", "Event not found.");
  return ok(ev, { maxAge: 60 });
});
