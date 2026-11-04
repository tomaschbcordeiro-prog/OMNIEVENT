/**
 * Studio posters: an event's own poster, drawn from its details in one of a few styles. The
 * same drawing is shown live in the Studio and rendered as an image on the server (for cards,
 * the event page and link previews), so it uses only inline styles and flex layout.
 */

export const POSTER_STYLES = [
  { id: "bold", label: "Bold", hint: "Big colour, big type" },
  { id: "minimal", label: "Minimal", hint: "Paper, ink and one accent" },
  { id: "neon", label: "Neon", hint: "Night-time glow" },
  { id: "retro", label: "Retro", hint: "Warm, with a setting sun" },
] as const;
export type PosterStyle = (typeof POSTER_STYLES)[number]["id"];
export const isPosterStyle = (s: unknown): s is PosterStyle => POSTER_STYLES.some((p) => p.id === s);

export const POSTER_W = 1200;
export const POSTER_H = 675;

export interface PosterData {
  title: string;
  tagline?: string;
  /** e.g. "SAT 14 DEC" */
  date?: string;
  /** e.g. "21:30" */
  time?: string;
  venue?: string;
  city?: string;
  /** e.g. "€12", "FREE" */
  price?: string;
  category?: string;
  hue: number;
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${((h % 360) + 360) % 360}, ${s}%, ${l}%, ${a})`;

/** Type size that keeps a name on three lines at most. */
function titleSize(title: string, base: number): number {
  const n = title.length;
  if (n <= 14) return base;
  if (n <= 24) return Math.round(base * 0.8);
  if (n <= 40) return Math.round(base * 0.64);
  if (n <= 60) return Math.round(base * 0.52);
  return Math.round(base * 0.42);
}

const row = { display: "flex", flexDirection: "row" as const };
const col = { display: "flex", flexDirection: "column" as const };

/** `font`: the family to draw with (the site's Geist; the server loads its files by that name). */
export function PosterArt({ data, styleId, font = "Geist" }: { data: PosterData; styleId: PosterStyle; font?: string }) {
  const d = { ...data, title: data.title.trim() || "Your event" };
  const where = [d.venue, d.city].filter(Boolean).join(" · ");
  const when = [d.date, d.time].filter(Boolean).join("  ·  ");
  const base = { width: POSTER_W, height: POSTER_H, display: "flex", position: "relative" as const, overflow: "hidden" as const, fontFamily: `${font}, sans-serif` };

  if (styleId === "minimal") {
    return (
      <div style={{ ...base, background: "#F5F1EA", color: "#14110F" }}>
        <div style={{ ...col, position: "absolute", left: 36, top: 36, right: 36, bottom: 36, border: "2px solid #14110F", padding: "56px 64px", justifyContent: "space-between" }}>
          <div style={{ ...row, alignItems: "center", gap: 18 }}>
            <div style={{ display: "flex", width: 56, height: 10, background: hsl(d.hue, 75, 50) }} />
            <div style={{ display: "flex", fontSize: 26, letterSpacing: 6, textTransform: "uppercase" }}>{d.category ?? "Event"}</div>
          </div>
          <div style={{ ...col }}>
            <div style={{ display: "flex", fontSize: titleSize(d.title, 112), fontWeight: 700, lineHeight: 1.02, letterSpacing: -2, maxWidth: 1000 }}>{d.title}</div>
            {d.tagline ? <div style={{ display: "flex", fontSize: 30, marginTop: 18, color: "#4A4540", maxWidth: 900 }}>{d.tagline}</div> : null}
          </div>
          <div style={{ ...row, justifyContent: "space-between", alignItems: "flex-end", fontSize: 30 }}>
            <div style={{ ...col }}>
              <div style={{ display: "flex", fontWeight: 700, letterSpacing: 2 }}>{when || "Date to be set"}</div>
              <div style={{ display: "flex", color: "#4A4540", marginTop: 6 }}>{where || "Somewhere wonderful"}</div>
            </div>
            {d.price ? <div style={{ display: "flex", fontSize: 34, fontWeight: 700, color: hsl(d.hue, 75, 40) }}>{d.price}</div> : null}
          </div>
        </div>
      </div>
    );
  }

  if (styleId === "neon") {
    const glow = hsl(d.hue, 100, 62);
    return (
      <div style={{ ...base, background: "#07081A", color: "#fff" }}>
        <div style={{ display: "flex", position: "absolute", left: -200, top: -260, width: 900, height: 900, borderRadius: 900, background: `radial-gradient(circle, ${hsl(d.hue, 100, 55, 0.45)}, transparent 65%)` }} />
        <div style={{ display: "flex", position: "absolute", right: -260, bottom: -320, width: 900, height: 900, borderRadius: 900, background: `radial-gradient(circle, ${hsl(d.hue + 60, 100, 55, 0.35)}, transparent 65%)` }} />
        <div style={{ ...col, position: "absolute", left: 70, top: 64, right: 70, bottom: 64, justifyContent: "space-between" }}>
          <div style={{ ...row, alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", width: 14, height: 14, borderRadius: 14, background: glow, boxShadow: `0 0 18px ${glow}` }} />
            <div style={{ display: "flex", fontSize: 26, letterSpacing: 8, textTransform: "uppercase", color: hsl(d.hue, 100, 80) }}>{d.category ?? "Tonight"}</div>
          </div>
          <div style={{ ...col }}>
            <div style={{ display: "flex", fontSize: titleSize(d.title, 120), fontWeight: 800, lineHeight: 1, letterSpacing: -2, color: hsl(d.hue, 100, 82), textShadow: `0 0 28px ${glow}, 0 0 60px ${hsl(d.hue, 100, 55, 0.6)}`, maxWidth: 1060, textTransform: "uppercase" }}>{d.title}</div>
            {d.tagline ? <div style={{ display: "flex", fontSize: 30, marginTop: 20, color: "rgba(255,255,255,0.78)", maxWidth: 900 }}>{d.tagline}</div> : null}
          </div>
          <div style={{ ...row, justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ ...row, alignItems: "center", gap: 22 }}>
              <div style={{ display: "flex", padding: "12px 22px", border: `3px solid ${glow}`, borderRadius: 16, fontSize: 32, fontWeight: 700, color: "#fff", boxShadow: `0 0 22px ${hsl(d.hue, 100, 60, 0.6)}` }}>{when || "Date to be set"}</div>
              <div style={{ display: "flex", fontSize: 28, color: "rgba(255,255,255,0.8)" }}>{where}</div>
            </div>
            {d.price ? <div style={{ display: "flex", fontSize: 34, fontWeight: 800, color: hsl(d.hue + 60, 100, 75) }}>{d.price}</div> : null}
          </div>
        </div>
      </div>
    );
  }

  if (styleId === "retro") {
    const ink = "#3A2412";
    const sun = hsl(d.hue, 80, 58);
    return (
      <div style={{ ...base, background: "#F2E3C6", color: ink }}>
        <div style={{ display: "flex", position: "absolute", right: 60, top: 70, width: 420, height: 420, borderRadius: 420, background: `linear-gradient(180deg, ${hsl(d.hue + 30, 90, 66)}, ${sun})` }} />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ display: "flex", position: "absolute", right: 40, top: 330 + i * 40, width: 460, height: 12 + i * 4, background: "#F2E3C6" }} />
        ))}
        <div style={{ display: "flex", position: "absolute", left: 0, right: 0, bottom: 0, height: 150, background: hsl(d.hue + 10, 45, 30) }} />
        <div style={{ ...col, position: "absolute", left: 70, top: 64, width: 700, bottom: 190 }}>
          <div style={{ display: "flex", fontSize: 26, letterSpacing: 8, textTransform: "uppercase", color: hsl(d.hue, 60, 38) }}>{d.category ?? "Presents"}</div>
          <div style={{ display: "flex", marginTop: 22, fontSize: titleSize(d.title, 104), fontWeight: 800, lineHeight: 1, letterSpacing: -1, textTransform: "uppercase" }}>{d.title}</div>
          {d.tagline ? <div style={{ display: "flex", fontSize: 28, marginTop: 18, color: "#6A4A2E" }}>{d.tagline}</div> : null}
        </div>
        <div style={{ ...row, position: "absolute", left: 70, right: 70, bottom: 38, height: 76, alignItems: "center", justifyContent: "space-between", color: "#F2E3C6" }}>
          <div style={{ ...row, alignItems: "center", gap: 26 }}>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 800, letterSpacing: 2 }}>{when || "Date to be set"}</div>
            <div style={{ display: "flex", fontSize: 28, opacity: 0.85 }}>{where}</div>
          </div>
          {d.price ? <div style={{ display: "flex", fontSize: 34, fontWeight: 800 }}>{d.price}</div> : null}
        </div>
      </div>
    );
  }

  // Bold
  return (
    <div style={{ ...base, background: `linear-gradient(135deg, ${hsl(d.hue, 85, 56)}, ${hsl(d.hue + 45, 80, 42)})`, color: "#fff" }}>
      <div style={{ display: "flex", position: "absolute", right: -140, top: -140, width: 520, height: 520, borderRadius: 520, background: "rgba(255,255,255,0.12)" }} />
      <div style={{ display: "flex", position: "absolute", right: 120, bottom: -220, width: 420, height: 420, borderRadius: 420, background: "rgba(0,0,0,0.12)" }} />
      <div style={{ ...col, position: "absolute", left: 70, top: 60, right: 70, bottom: 60, justifyContent: "space-between" }}>
        <div style={{ ...row }}>
          <div style={{ display: "flex", padding: "8px 18px", borderRadius: 999, background: "rgba(255,255,255,0.2)", fontSize: 26, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase" }}>{d.category ?? "Event"}</div>
        </div>
        <div style={{ ...col }}>
          <div style={{ display: "flex", fontSize: titleSize(d.title, 128), fontWeight: 900, lineHeight: 0.98, letterSpacing: -3, textTransform: "uppercase", maxWidth: 1060 }}>{d.title}</div>
          {d.tagline ? <div style={{ display: "flex", fontSize: 30, marginTop: 18, color: "rgba(255,255,255,0.88)", maxWidth: 900 }}>{d.tagline}</div> : null}
        </div>
        <div style={{ ...row, justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ ...row, alignItems: "center", gap: 24 }}>
            <div style={{ display: "flex", padding: "12px 22px", borderRadius: 18, background: "#fff", color: hsl(d.hue, 70, 30), fontSize: 32, fontWeight: 800 }}>{when || "Date to be set"}</div>
            <div style={{ display: "flex", fontSize: 28, color: "rgba(255,255,255,0.92)" }}>{where}</div>
          </div>
          {d.price ? <div style={{ display: "flex", fontSize: 38, fontWeight: 900 }}>{d.price}</div> : null}
        </div>
      </div>
    </div>
  );
}

/** "SAT 14 DEC" and "21:30" for a local day and time. */
export function posterWhen(date?: string, time?: string): { date?: string; time?: string } {
  if (!date) return { time };
  const d = new Date(`${date}T12:00:00Z`);
  const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "").toUpperCase();
  return { date: label, time };
}
