import { ImageResponse } from "next/og";
import { ensureFresh, getEventView, waitForData } from "@/lib/store";
import { getCategory, groupOf, GROUP_HEX } from "@/lib/categories";
import { formatEventTime, formatShortDate } from "@/lib/format";
import { loadOgFonts } from "@/lib/og-fonts";
import { clientKey, rateLimit } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const W = 1200;
const H = 630;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * GET /api/events/<slug>/card — the picture shown when an event without a photo of its own is
 * shared (WhatsApp, Messages, social posts): its date set large, the title, the place, in its
 * category's colours. 1200×630.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  // Drawing a picture costs time on the server: a visitor gets thirty a minute (link previews
  // ask once, and the CDN keeps each card for a day).
  if (!rateLimit(`card:${clientKey(req)}`, 30)) return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  const { slug } = await params;
  if (!/^[\w.-]{1,200}$/.test(slug)) return new Response("Not found", { status: 404 });
  await ensureFresh();
  let e = getEventView(slug);
  if (!e) {
    await waitForData(15000);
    e = getEventView(slug);
  }
  if (!e || e.provenance.isDemo) return new Response("Not found", { status: 404 });

  const group = groupOf(e.categorySlug);
  const accent = GROUP_HEX[group] ?? "#7c8db5";
  const hue = e.posterHue ?? 215;
  const d = formatShortDate(e.start, e.timeZone);
  const daily = e.eventType === "daily_attraction";
  const label = (getCategory(e.categorySlug)?.name ?? getCategory(group)?.name ?? "Event").toUpperCase();
  const month = new Date(e.start).toLocaleDateString("en-GB", { month: "long", timeZone: e.timeZone });
  const when = daily ? "Open every day" : `${d.weekday} ${Number(d.day)} ${month}${e.hoursUnknown ? "" : ` · ${formatEventTime(e.start, e.timeZone)}`}`;
  const title = clip(e.title, 90);
  const fonts = await loadOgFonts();

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          color: "#fff",
          fontFamily: "Geist",
          background: `radial-gradient(90% 130% at 100% 0%, ${accent}99, transparent 62%), radial-gradient(70% 100% at 0% 100%, hsla(${(hue + 40) % 360}, 80%, 52%, 0.45), transparent 60%), linear-gradient(135deg, hsl(${hue}, 55%, 15%), hsl(${(hue + 30) % 360}, 58%, 26%))`,
          padding: 64,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 26, fontWeight: 900, letterSpacing: 1 }}>
            <div style={{ display: "flex", width: 34, height: 34, borderRadius: 34, background: "linear-gradient(135deg, #3b82f6, #1d4ed8)", border: "3px solid rgba(255,255,255,0.85)" }} />
            OMNIEVENT
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 24, fontWeight: 700, letterSpacing: 4, opacity: 0.85 }}>{label}</div>
            <div style={{ display: "flex", fontSize: title.length > 50 ? 58 : 72, fontWeight: 900, lineHeight: 1.04, marginTop: 14, maxWidth: 820, letterSpacing: -1.5 }}>{title}</div>
            <div style={{ display: "flex", fontSize: 32, fontWeight: 700, marginTop: 26 }}>{when}</div>
            <div style={{ display: "flex", fontSize: 28, marginTop: 8, opacity: 0.85 }}>{clip(`${e.venue.name} · ${e.venue.city}`, 60)}</div>
          </div>
        </div>
        {!daily && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "flex-start", marginLeft: 24 }}>
            <div style={{ display: "flex", fontSize: 200, fontWeight: 900, lineHeight: 0.9, letterSpacing: -8, opacity: 0.95 }}>{d.day}</div>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: 6, opacity: 0.8 }}>{d.month.toUpperCase()}</div>
          </div>
        )}
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: fonts.length ? fonts : undefined,
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" },
    },
  );
}
