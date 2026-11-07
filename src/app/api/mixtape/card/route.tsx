import { ImageResponse } from "next/og";
import { dataReady, ensureFresh, getCards } from "@/lib/store";
import { getDestination } from "@/lib/destinations";
import { parseTapeQuery } from "@/lib/mixtape/share";
import { tapeHue, tapeName } from "@/lib/mixtape/plan";
import { loadOgFonts } from "@/lib/og-fonts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const W = 1200;
const H = 630;
const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${((h % 360) + 360) % 360}, ${s}%, ${l}%, ${a})`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** A reel: the wound tape, the hub and its teeth. */
function Reel({ tape }: { tape: number }) {
  return (
    <svg width="96" height="96" viewBox="-48 -48 96 96">
      <circle r={tape} fill="#3b2f25" />
      <circle r="21" fill="#f4efe4" />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <rect key={a} x="-3" y="-21" width="6" height="9" rx="1.5" fill="#141826" transform={`rotate(${a})`} />
      ))}
      <circle r="7" fill="#141826" />
    </svg>
  );
}

/**
 * GET /api/mixtape/card?<tape link> — a shared Mixtape as a 1200×630 picture for link
 * previews: the cassette with its name, and the first tracks. Everything it shows is in the
 * address, so each one is cached for good.
 */
export async function GET(req: Request) {
  const link = parseTapeQuery(new URL(req.url).searchParams);
  const city = link ? getDestination(link.city) : undefined;
  if (!link || !city || city.kind !== "city") return new Response("Not found", { status: 404 });
  await ensureFresh();
  const ids = link.tracks.map((t) => t.id);
  let cards = new Map(getCards(ids).map((c) => [c.id, c]));
  // A server that has just started may still be loading some sources: give it a few seconds.
  for (let i = 0; i < 4 && cards.size < ids.length && !dataReady(); i++) {
    await new Promise((r) => setTimeout(r, 1500));
    await ensureFresh();
    cards = new Map(getCards(ids).map((c) => [c.id, c]));
  }
  const tz = city.timeZone ?? "UTC";
  const when = (t: number, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...o }).format(new Date(t)).replace(",", "").toUpperCase();
  const tracks = link.tracks.filter((t) => cards.has(t.id));
  const name = link.name ?? tapeName(city.name, link.vibe, city.id.length);
  const hue = tapeHue(link.vibe.energy);
  const dates =
    tracks.length > 0
      ? (() => {
          const a = when(tracks[0].start, { weekday: "short", day: "numeric", month: "short" });
          const b = when(tracks[tracks.length - 1].start, { weekday: "short", day: "numeric", month: "short" });
          return a === b ? a : `${a} – ${b}`;
        })()
      : "";
  const loaded = await loadOgFonts();
  const font = loaded.length ? "Geist" : "sans-serif";
  const shown = tracks.slice(0, 5);

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", alignItems: "center", padding: "0 64px", background: `linear-gradient(135deg, ${hsl(hue, 70, 14)}, ${hsl(hue + 35, 65, 30)})`, color: "#fff", fontFamily: `${font}, sans-serif` }}>
        <div style={{ display: "flex", position: "absolute", right: -160, top: -200, width: 640, height: 640, borderRadius: 640, background: `radial-gradient(circle, ${hsl(hue, 90, 60, 0.35)}, transparent 70%)` }} />
        {/* The cassette */}
        <div style={{ display: "flex", flexDirection: "column", width: 470, height: 300, borderRadius: 30, background: "linear-gradient(180deg, #262b3d, #141826)", border: "2px solid rgba(255,255,255,0.14)", padding: "22px 26px", boxShadow: "0 30px 60px rgba(0,0,0,0.45)" }}>
          <div style={{ display: "flex", flexDirection: "column", borderRadius: 14, background: "#fbf6ea", height: 186, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: 36, padding: "0 16px", background: hsl(hue, 85, 58), color: "#fff", fontSize: 15, fontWeight: 900, letterSpacing: 3 }}>
              <div style={{ display: "flex" }}>OMNIEVENT · MIXTAPE</div>
              <div style={{ display: "flex", fontSize: 22 }}>A</div>
            </div>
            <div style={{ display: "flex", padding: "10px 18px 0", fontSize: name.length > 22 ? 24 : 30, fontWeight: 900, color: "#1b1712", letterSpacing: -0.5 }}>{clip(name, 34)}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "8px 18px 0", height: 92, borderRadius: 46, background: "#0b0d14", padding: "0 18px" }}>
              <Reel tape={40} />
              <div style={{ display: "flex", flex: 1, height: 4, margin: "36px 6px 0", background: "#3b2f25" }} />
              <Reel tape={30} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 18 }}>
            <div style={{ display: "flex", width: 210, height: 44, borderRadius: 10, background: "#0f121c", border: "2px solid rgba(255,255,255,0.08)" }} />
          </div>
        </div>
        {/* What's on it */}
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 60, flex: 1 }}>
          <div style={{ display: "flex", fontSize: 22, fontWeight: 700, letterSpacing: 6, color: hsl(hue, 90, 80) }}>{`MIXTAPE · ${city.name.toUpperCase()}`}</div>
          <div style={{ display: "flex", fontSize: name.length > 24 ? 46 : 56, fontWeight: 900, lineHeight: 1.02, letterSpacing: -1.5, marginTop: 12 }}>{clip(name, 48)}</div>
          {dates ? <div style={{ display: "flex", fontSize: 24, marginTop: 10, color: "rgba(255,255,255,0.75)", fontWeight: 700, letterSpacing: 1 }}>{dates}</div> : null}
          <div style={{ display: "flex", flexDirection: "column", marginTop: 26 }}>
            {shown.map((t, i) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", fontSize: 24, marginTop: i ? 10 : 0 }}>
                <div style={{ display: "flex", width: 46, color: hsl(hue, 90, 75), fontWeight: 900 }}>{String(i + 1).padStart(2, "0")}</div>
                <div style={{ display: "flex", width: 150, color: "rgba(255,255,255,0.7)", fontWeight: 700 }}>{when(t.start, { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</div>
                <div style={{ display: "flex", fontWeight: 700 }}>{clip(cards.get(t.id)!.title, 27)}</div>
              </div>
            ))}
            {tracks.length > shown.length ? <div style={{ display: "flex", fontSize: 22, marginTop: 10, color: "rgba(255,255,255,0.6)" }}>{`+ ${tracks.length - shown.length} more`}</div> : null}
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: loaded.length ? loaded : undefined,
      // Kept for good once every track is found; while this server is still loading events, only briefly.
      headers: { "Cache-Control": tracks.length === link.tracks.length && dataReady() ? "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" : "public, max-age=60, s-maxage=60" },
    },
  );
}
