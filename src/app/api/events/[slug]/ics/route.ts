import { NextRequest } from "next/server";
import { ensureFresh, getEventView } from "@/lib/store";
import { apiError } from "@/lib/api";
import { calendar, vevent } from "@/lib/ics";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

export const dynamic = "force-dynamic";

/** GET /api/events/:slug/ics — iCalendar file for the event. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  await ensureFresh();
  const e = getEventView(slug);
  if (!e) return apiError(404, "not_found", "Event not found.");
  const body = calendar([vevent(e, new URL(`/events/${e.slug}`, req.url).toString())]);
  return new Response(body, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${e.slug.slice(0, 60)}.ics"` },
  });
}
