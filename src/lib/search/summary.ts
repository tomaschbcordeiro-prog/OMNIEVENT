import type { SearchFilters } from "../types";
import { GROUPS, getCategory } from "../categories";
import { getDestination } from "../destinations";
import { formatKm } from "../map/circle";

const fmtDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** One-line, human description of a search, used in chips, banners and saved searches. */
export function summarizeSearch(f: SearchFilters): { where?: string; when?: string; what?: string; text: string } {
  const where = f.near
    ? `${f.nearLabel ?? "Selected area"}, ${formatKm(f.near.radiusKm)}`
    : f.city
      ? getDestination(f.city)?.name
      : f.country
        ? getDestination(f.country.toLowerCase())?.name
        : f.continent
          ? getDestination(f.continent)?.name
          : undefined;
  const date = f.from ? (f.to && f.to !== f.from ? `${fmtDay(f.from)}–${fmtDay(f.to)}` : fmtDay(f.from)) : undefined;
  const time = f.tFrom || f.tTo ? `${f.tFrom ?? "00:00"}–${f.tTo ?? "24:00"}` : undefined;
  const when = [date, time].filter(Boolean).join(", ") || undefined;
  const what = f.categories?.length ? f.categories.map((c) => (GROUPS.find((g) => g.slug === c) ?? getCategory(c))?.name.split(" &")[0] ?? c).join(", ") : undefined;
  return { where, when, what, text: [where, when, what, f.q ? `“${f.q}”` : undefined].filter(Boolean).join(" · ") || "All events" };
}

/** Filters that carry from page to page (where, when, what), without paging or sorting. */
export function portableFilters(f: SearchFilters): SearchFilters {
  return { near: f.near, nearLabel: f.nearLabel, from: f.from, to: f.to, tFrom: f.tFrom, tTo: f.tTo, categories: f.categories, minPrice: f.minPrice, maxPrice: f.maxPrice, currency: f.currency, access: f.access, family: f.family };
}

export const hasWhereOrWhen = (f: SearchFilters) => !!(f.near || f.from || f.to || f.tFrom || f.tTo);
