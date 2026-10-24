import { NextRequest } from "next/server";
import { ensureFresh, getEventView } from "@/lib/store";
import { apiError } from "@/lib/api";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** GET /api/events/:slug/ics — iCalendar file for the event (times in UTC, which every calendar converts). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  await ensureFresh();
  const e = getEventView(slug);
  if (!e) return apiError(404, "not_found", "Event not found.");
  const end = e.end ?? new Date(new Date(e.start).getTime() + (e.durationMinutes ?? 120) * 60000).toISOString();
  const url = new URL(`/events/${e.slug}`, req.url).toString();
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OMNIEVENT//EN",
    "BEGIN:VEVENT",
    `UID:${e.id}@omnievent`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(e.title + (e.provenance.isDemo ? " (demo)" : ""))}`,
    `LOCATION:${esc([e.venue.name, e.venue.address, e.venue.city, e.venue.country].filter(Boolean).join(", "))}`,
    `GEO:${e.venue.lat};${e.venue.lng}`,
    `URL:${url}`,
    `DESCRIPTION:${esc(`${e.description ?? ""}\n\n${url}`)}`,
    e.status === "cancelled" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return new Response(body, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${e.slug.slice(0, 60)}.ics"` },
  });
}
