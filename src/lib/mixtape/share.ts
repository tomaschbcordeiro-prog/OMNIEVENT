/**
 * A tape as a link (so it can be shared without an account or a database) and as a calendar
 * file (every track in one go).
 */
import { BUDGET, DEFAULT_VIBE, ENERGY, MOODS, RANGE, type Track, type Vibe } from "./plan";
import type { WhenKind } from "./windows";

export interface TapeLink {
  city: string;
  kind: WhenKind;
  fromDate: string;
  toDate: string;
  vibe: Vibe;
  name?: string;
  tracks: Track[];
}

const KINDS: WhenKind[] = ["tonight", "tomorrow", "weekend", "next-weekend", "dates"];
const ID = /^[\w:.-]{1,160}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const clampInt = (s: string | undefined, max: number, dflt: number) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : dflt;
};

/** Query string for a tape: c, w, d, v, m, n and t (id~start~len, start in minutes since 1970, base 36). */
export function tapeQuery(l: TapeLink): string {
  const p = new URLSearchParams();
  p.set("c", l.city);
  p.set("w", l.kind);
  p.set("d", `${l.fromDate}_${l.toDate}`);
  p.set("v", `${l.vibe.energy}${l.vibe.budget}${l.vibe.range}`);
  if (l.vibe.moods.length) p.set("m", l.vibe.moods.join(","));
  if (l.name?.trim()) p.set("n", l.name.trim().slice(0, 60));
  if (l.tracks.length)
    p.set("t", l.tracks.map((t) => `${t.id}~${Math.round(t.start / 60000).toString(36)}~${Math.round((t.end - t.start) / 60000).toString(36)}${t.flex ? "~f" : ""}`).join(","));
  return p.toString();
}

/** A tape from a shared link, or null when it isn't one. Anything malformed is dropped. */
export function parseTapeQuery(sp: URLSearchParams | Record<string, string | string[] | undefined>): TapeLink | null {
  const get = (k: string) => {
    const v = sp instanceof URLSearchParams ? sp.get(k) ?? undefined : sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const city = get("c");
  if (!city || !/^[a-z0-9-]{1,60}$/.test(city)) return null;
  const kind = (KINDS as string[]).includes(get("w") ?? "") ? (get("w") as WhenKind) : "weekend";
  const [fromDate, toDate] = (get("d") ?? "").split("_");
  const v = get("v") ?? "";
  const vibe: Vibe = {
    energy: clampInt(v[0], ENERGY.length - 1, DEFAULT_VIBE.energy),
    budget: clampInt(v[1], BUDGET.length - 1, DEFAULT_VIBE.budget),
    range: clampInt(v[2], RANGE.length - 1, DEFAULT_VIBE.range),
    moods: (get("m") ?? "").split(",").filter((m) => MOODS.some((x) => x.id === m)).slice(0, MOODS.length),
  };
  const tracks: Track[] = [];
  for (const part of (get("t") ?? "").split(",").slice(0, 12)) {
    const [id, s, len, f] = part.split("~");
    const start = parseInt(s ?? "", 36) * 60000;
    const dur = parseInt(len ?? "", 36) * 60000;
    if (!id || !ID.test(id) || !Number.isFinite(start) || !(dur > 0 && dur <= 24 * 3600000)) continue;
    tracks.push({ id, start, end: start + dur, flex: f === "f" || undefined });
  }
  const name = get("n")?.replace(/[\u0000-\u001f]/g, "").slice(0, 60);
  return {
    city,
    kind,
    fromDate: YMD.test(fromDate ?? "") ? fromDate : "",
    toDate: YMD.test(toDate ?? "") ? toDate : "",
    vibe,
    name: name || undefined,
    tracks: tracks.sort((a, b) => a.start - b.start),
  };
}

// ---- calendar (.ics)

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (t: number) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** Lines longer than 75 octets are folded (RFC 5545). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let n = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (n + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      n = 0;
    }
    cur += ch;
    n += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export interface IcsTrack {
  id: string;
  title: string;
  start: number;
  end: number;
  venue: string;
  url: string;
  flex?: boolean;
}

/** A calendar file with every track of the tape. */
export function tapeIcs(name: string, tracks: IcsTrack[], now = Date.now()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OMNIEVENT//Mixtape//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(name)}`];
  tracks.forEach((t, i) => {
    const note = `Track ${i + 1} of ${tracks.length} on "${name}".${t.flex ? " Drop in any time while it's open; this time is a suggestion." : ""} Details and tickets: ${t.url}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${t.id.replace(/[^\w.-]/g, "")}-${Math.round(t.start / 60000)}@omnievent`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(t.start)}`,
      `DTEND:${stamp(t.end)}`,
      `SUMMARY:${esc(t.title)}`,
      `LOCATION:${esc(t.venue)}`,
      `URL:${t.url}`,
      `DESCRIPTION:${esc(note)}`,
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
