import { z } from "zod";
import type { EventStatus, SearchFilters } from "../types";

/**
 * Single source of truth for encoding filters in URLs. Used by pages (shareable
 * URLs) and API routes (validated with zod — invalid params produce a 400).
 */

const STATUSES = ["scheduled", "on_sale", "sold_out", "postponed", "rescheduled", "cancelled", "completed", "free_entry", "registration_required", "unknown"] as const;
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const list = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean));
const num = z.coerce.number().finite();

export const filtersSchema = z
  .object({
    q: z.string().max(200).optional(),
    cat: list.pipe(z.array(z.string().regex(/^[a-z0-9-]+$/)).max(20)).optional(),
    from: ymd.optional(),
    to: ymd.optional(),
    city: z.string().max(60).regex(/^[a-z0-9-]+$/).optional(),
    country: z.string().regex(/^[A-Za-z]{2}$/).optional(),
    continent: z.string().max(30).regex(/^[a-z-]+$/).optional(),
    lat: num.min(-90).max(90).optional(),
    lng: num.min(-180).max(180).optional(),
    radius: num.min(0.5).max(2000).optional(),
    pl: z.string().max(100).optional(),
    tfrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM").optional(),
    tto: z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, "expected HH:MM").optional(),
    min: num.min(0).optional(),
    max: num.min(0).optional(),
    cur: z.string().regex(/^[A-Z]{3}$/).optional(),
    status: list.pipe(z.array(z.enum(STATUSES))).optional(),
    access: z.enum(["ticketed", "free", "registration"]).optional(),
    family: z.enum(["1", "true"]).optional(),
    online: z.enum(["online", "in_person"]).optional(),
    accessible: z.enum(["1", "true"]).optional(),
    indoor: z.enum(["indoor", "outdoor"]).optional(),
    participant: z.string().max(120).optional(),
    venue: z.string().max(160).optional(),
    gdeg: num.min(0).max(30).optional(),
    gkeys: list.pipe(z.array(z.string().max(120).regex(/^[\w:.-]+$/)).max(300)).optional(),
    sport: z.string().max(40).optional(),
    competition: z.string().max(80).optional(),
    source: z.enum(["all", "demo", "live"]).optional(),
    live: z.enum(["1", "true"]).optional(),
    sort: z.enum(["relevance", "date", "price", "distance", "announced"]).optional(),
    page: z.coerce.number().int().min(1).max(500).optional(),
    size: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine((v) => !(v.from && v.to) || v.from <= v.to, { message: "`from` must be before `to`", path: ["from"] })
  .refine((v) => v.min == null || v.max == null || v.min <= v.max, { message: "`min` must be ≤ `max`", path: ["min"] });

export type FilterParams = z.input<typeof filtersSchema>;

export function parseFilterParams(sp: URLSearchParams): { ok: true; filters: SearchFilters } | { ok: false; error: z.ZodError } {
  const raw: Record<string, string> = {};
  sp.forEach((v, k) => {
    if (v !== "") raw[k] = v;
  });
  const r = filtersSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: r.error };
  const v = r.data;
  const f: SearchFilters = {
    q: v.q,
    categories: v.cat,
    from: v.from,
    to: v.to,
    city: v.city,
    country: v.country?.toUpperCase(),
    continent: v.continent,
    near: v.lat != null && v.lng != null ? { lat: v.lat, lng: v.lng, radiusKm: v.radius ?? 10 } : undefined,
    nearLabel: v.lat != null ? v.pl : undefined,
    tFrom: v.tfrom,
    tTo: v.tto,
    minPrice: v.min,
    maxPrice: v.max,
    currency: v.cur,
    status: v.status as EventStatus[] | undefined,
    access: v.access,
    family: v.family ? true : undefined,
    online: v.online,
    accessible: v.accessible ? true : undefined,
    indoor: v.indoor,
    participant: v.participant,
    venue: v.venue,
    group: v.gdeg != null && v.gkeys?.length ? { deg: v.gdeg, keys: v.gkeys } : undefined,
    sport: v.sport,
    competition: v.competition,
    source: v.source,
    live: v.live ? true : undefined,
    sort: v.sort,
    page: v.page,
    pageSize: v.size,
  };
  return { ok: true, filters: f };
}

export function filtersToParams(f: SearchFilters): URLSearchParams {
  const p = new URLSearchParams();
  const set = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "" || v === false) return;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(","));
      return;
    }
    p.set(k, String(v === true ? 1 : v));
  };
  set("q", f.q);
  set("cat", f.categories);
  set("from", f.from);
  set("to", f.to);
  set("city", f.city);
  set("country", f.country);
  set("continent", f.continent);
  if (f.near) {
    set("lat", f.near.lat.toFixed(4));
    set("lng", f.near.lng.toFixed(4));
    set("radius", Math.round(f.near.radiusKm * 10) / 10);
    set("pl", f.nearLabel);
  }
  set("tfrom", f.tFrom);
  set("tto", f.tTo);
  set("min", f.minPrice);
  set("max", f.maxPrice);
  set("cur", f.currency);
  set("status", f.status);
  set("access", f.access);
  set("family", f.family);
  set("online", f.online);
  set("accessible", f.accessible);
  set("indoor", f.indoor);
  set("participant", f.participant);
  set("venue", f.venue);
  if (f.group) {
    set("gdeg", f.group.deg);
    set("gkeys", f.group.keys);
  }
  set("sport", f.sport);
  set("competition", f.competition);
  set("source", f.source && f.source !== "all" ? f.source : undefined);
  set("live", f.live);
  set("sort", f.sort);
  set("page", f.page && f.page > 1 ? f.page : undefined);
  set("size", f.pageSize);
  return p;
}

/** Count of user-visible active filters (for badges). */
export function activeFilterCount(f: SearchFilters): number {
  return [
    f.categories?.length,
    f.from || f.to || f.live,
    f.city || f.country || f.continent,
    f.near,
    f.tFrom || f.tTo,
    f.minPrice != null || f.maxPrice != null,
    f.status?.length,
    f.access,
    f.family,
    f.online,
    f.accessible,
    f.indoor,
    f.source && f.source !== "all",
  ].filter(Boolean).length;
}
