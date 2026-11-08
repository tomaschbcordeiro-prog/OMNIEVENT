import { NextRequest } from "next/server";
import { ensureFresh, getEventView } from "@/lib/store";
import { apiError, clientKey, rateLimit } from "@/lib/api";
import { calendar, vevent } from "@/lib/ics";

export const dynamic = "force-dynamic";

/** GET /api/events/calendar?ids=a,b,c — several events (saved ones, a trip) in one calendar file. */
export async function GET(req: NextRequest) {
  if (!rateLimit(`ics:${clientKey(req)}`, 30)) return apiError(429, "rate_limited", "Too many requests.");
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .filter((x) => /^[\w:.-]{1,160}$/.test(x))
    .slice(0, 100);
  if (!ids.length) return apiError(400, "invalid", "No events given.");
  await ensureFresh();
  const events = ids.map((id) => getEventView(id)).filter((e): e is NonNullable<typeof e> => !!e);
  if (!events.length) return apiError(404, "not_found", "None of these events is listed any more.");
  const body = calendar(events.map((e) => vevent(e, new URL(`/events/${e.slug}`, req.url).toString())));
  return new Response(body, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="omnievent-saved.ics"', "Cache-Control": "private, no-store" },
  });
}
