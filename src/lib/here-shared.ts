/**
 * "Here": the city the site shows first. Found from the visitor's connection (city level, by
 * the hosting network), from their device's location when they ask, or chosen by them; or
 * "anywhere" when they'd rather see the whole planet. Kept in a cookie so every page can
 * open on it. Shared by the server and the browser.
 */

export const HERE_COOKIE = "oe_here";

export interface HereCity {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  tz: string;
  /** Upcoming events there. */
  n: number;
}

export type HereSource = "ip" | "gps" | "chosen" | "any" | "none";

export interface Here {
  city: HereCity | null;
  source: HereSource;
}

export const NOWHERE: Here = { city: null, source: "none" };

/** What the cookie holds: a city id and how it was found, or "any". */
export function parseHereCookie(v: string | undefined): { id: string; source: "gps" | "chosen" } | "any" | null {
  if (!v) return null;
  if (v === "any") return "any";
  const [id, source] = v.split("~");
  if (!id || !/^[a-z0-9-]{1,60}$/.test(id)) return null;
  return { id, source: source === "gps" ? "gps" : "chosen" };
}

export const hereCookieValue = (h: { id: string; source: "gps" | "chosen" } | "any") => (h === "any" ? "any" : `${h.id}~${h.source}`);
