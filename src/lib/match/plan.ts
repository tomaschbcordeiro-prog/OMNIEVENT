import { CATEGORIES, getCategory } from "../categories";
import { ALL_DESTINATIONS, getDestination } from "../destinations";
import { parseQuery } from "../search/parse";
import type { SearchFilters } from "../types";

/**
 * A Match plan: what the visitor asked for, as chips.
 *
 * - Places are alternatives: Lisbon + Madrid means events in Lisbon or in Madrid.
 * - Keywords and vibes are alternatives too: jazz + comedy means either.
 * - The two combine: Lisbon + Madrid + jazz means jazz in Lisbon or Madrid.
 * - When, free entry, a price cap and "near me" apply on top.
 */

export type WhenPreset = "tonight" | "tomorrow" | "weekend" | "month" | "any";
export type When = WhenPreset | { from: string; to: string; label: string };

export interface PlaceChip { id: string; label: string }
/** A keyword, phrase or category; `cat` when it names a category. */
export interface WhatChip { text: string; label: string; cat?: string }

export interface Plan {
  places: PlaceChip[];
  what: WhatChip[];
  when: When;
  free?: boolean;
  maxPrice?: { amount: number; currency?: string };
  near?: { lat: number; lng: number };
}

export const EMPTY_PLAN: Plan = { places: [], what: [], when: "month" };

export const WHEN_LABEL: Record<WhenPreset, string> = { tonight: "Tonight", tomorrow: "Tomorrow", weekend: "This weekend", month: "Next 30 days", any: "Any time" };

const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Local calendar day `n` days from today, as YYYY-MM-DD. */
function dayFromToday(n: number, now = new Date()): string {
  return ymd(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + n)));
}

export function whenRange(w: When, now = new Date()): { from?: string; to?: string; tFrom?: string } {
  if (typeof w === "object") return { from: w.from, to: w.to };
  const today = dayFromToday(0, now);
  switch (w) {
    case "tonight":
      return { from: today, to: today, tFrom: "17:00" };
    case "tomorrow":
      return { from: dayFromToday(1, now), to: dayFromToday(1, now) };
    case "weekend": {
      const dow = now.getDay();
      const start = dow === 0 || dow === 6 ? 0 : 5 - dow;
      const end = dow === 0 ? 0 : 7 - dow;
      return { from: dayFromToday(start, now), to: dayFromToday(end, now) };
    }
    case "month":
      return { from: today, to: dayFromToday(30, now) };
    default:
      return {};
  }
}

export function planToFilters(p: Plan, now = new Date()): SearchFilters {
  return {
    ...whenRange(p.when, now),
    places: p.places.length ? p.places.map((x) => x.id) : undefined,
    anyOf: p.what.length ? p.what.map((x) => x.cat ?? x.text) : undefined,
    access: p.free ? "free" : undefined,
    maxPrice: p.maxPrice?.amount,
    currency: p.maxPrice?.currency,
    near: p.near ? { ...p.near, radiusKm: 60 } : undefined,
  };
}

const placeLabel = (id: string) => getDestination(id)?.name ?? id;
const catLabel = (slug: string) => getCategory(slug)?.name ?? slug;

/** The plan in the URL, so it can be shared and survives a reload. */
export function planToParams(p: Plan): URLSearchParams {
  const q = new URLSearchParams();
  if (p.places.length) q.set("places", p.places.map((x) => x.id).join(","));
  if (p.what.length) q.set("any", p.what.map((x) => x.cat ?? x.text).join("|"));
  if (typeof p.when === "object") {
    q.set("from", p.when.from);
    q.set("to", p.when.to);
  } else if (p.when !== "month") q.set("when", p.when);
  if (p.free) q.set("free", "1");
  if (p.maxPrice) q.set("max", `${p.maxPrice.amount}${p.maxPrice.currency ? ` ${p.maxPrice.currency}` : ""}`);
  return q;
}

export function planFromParams(q: URLSearchParams): Plan {
  const places = (q.get("places") ?? "").split(",").filter((id) => id && getDestination(id)).slice(0, 20).map((id) => ({ id, label: placeLabel(id) }));
  const what = (q.get("any") ?? "").split("|").map((t) => t.trim()).filter(Boolean).slice(0, 15).map((t) => (getCategory(t) ? { text: t, label: catLabel(t), cat: t } : { text: t, label: t }));
  const w = q.get("when") as WhenPreset | null;
  const from = q.get("from");
  const to = q.get("to");
  const when: When = from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) ? { from, to: to < from ? from : to, label: rangeLabel(from, to) } : w && w in WHEN_LABEL ? w : "month";
  const max = (q.get("max") ?? "").match(/^(\d+(?:\.\d+)?)(?: ([A-Z]{3}))?$/);
  return { places, what, when, free: q.get("free") === "1" || undefined, maxPrice: max ? { amount: Number(max[1]), currency: max[2] } : undefined };
}

const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const rangeLabel = (from: string, to: string) => (from === to ? short(from) : `${short(from)} – ${short(to)}`);

const SYMBOL: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };

/** "Jazz or comedy in Lisbon or Madrid, this weekend, free" */
export function planSentence(p: Plan): string {
  const or = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
  const what = p.what.length ? or(p.what.map((x) => x.label)) : "Anything";
  const where = p.near ? " near you" : p.places.length ? ` in ${or(p.places.map((x) => x.label))}` : " anywhere";
  const when = typeof p.when === "object" ? p.when.label : WHEN_LABEL[p.when].toLowerCase();
  const extra = [p.free ? "free" : "", p.maxPrice ? `under ${SYMBOL[p.maxPrice.currency ?? ""] ?? ""}${p.maxPrice.amount}${p.maxPrice.currency && !SYMBOL[p.maxPrice.currency] ? ` ${p.maxPrice.currency}` : ""}` : ""].filter(Boolean);
  return `${what}${where}, ${when}${extra.length ? `, ${extra.join(", ")}` : ""}`;
}

export interface Parsed {
  places: PlaceChip[];
  what: WhatChip[];
  when?: When;
  free?: boolean;
  maxPrice?: { amount: number; currency?: string };
}

/**
 * Turns what was typed into chips. Several things at once work too, separated by commas,
 * "+", "and", "e", "y", "ou", "or": "Lisboa, Madrid e jazz" gives two places and one vibe.
 */
export function parseInput(text: string, timeZone?: string, now = new Date()): Parsed {
  const out: Parsed = { places: [], what: [] };
  const parts = text
    .split(/,|\+|;|\s+(?:and|e|y|ou|or|et|und|&)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    const q = parseQuery(part, { timeZone, now });
    const f = q.filters;
    const place = f.city ?? (f.country ? f.country.toLowerCase() : undefined) ?? f.continent;
    if (place && getDestination(place) && !out.places.some((x) => x.id === place)) out.places.push({ id: place, label: placeLabel(place) });
    for (const c of f.categories ?? []) if (!out.what.some((x) => x.cat === c)) out.what.push({ text: c, label: catLabel(c), cat: c });
    if (f.family && !out.what.some((x) => x.cat === "family")) out.what.push({ text: "family", label: catLabel("family"), cat: "family" });
    if (f.access === "free") out.free = true;
    if (f.maxPrice != null) out.maxPrice = { amount: f.maxPrice, currency: f.currency };
    if (f.from && f.to) {
      const label = q.interpretation.find((i) => i.key === "date")?.label ?? rangeLabel(f.from, f.to);
      const preset: Record<string, WhenPreset> = { Tonight: "tonight", Today: "tonight", Tomorrow: "tomorrow", "This weekend": "weekend" };
      out.when = preset[label] ?? { from: f.from, to: f.to, label };
    }
    // What's left over is a keyword: an artist, a team, a venue, a word ("coldplay", "fado").
    const rest = q.residual.trim();
    if (rest && !out.what.some((x) => x.text === rest)) out.what.push({ text: rest, label: rest });
  }
  return out;
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Places and categories whose name (or another-language name) starts with what's being typed. */
export function suggest(text: string, limit = 6): { places: (PlaceChip & { sub?: string })[]; cats: WhatChip[] } {
  const q = fold(text.trim());
  if (q.length < 2) return { places: [], cats: [] };
  const rank = { city: 0, country: 1, continent: 2 } as Record<string, number>;
  const places = ALL_DESTINATIONS.filter((d) => [d.name, ...(d.aliases ?? [])].some((n) => fold(n).startsWith(q)))
    .sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3) || (b.population ?? 0) - (a.population ?? 0))
    .slice(0, limit)
    .map((d) => ({ id: d.id, label: d.name, sub: d.kind === "city" ? d.country : d.kind === "country" ? "Country" : "Continent" }));
  const cats = CATEGORIES.filter((c) => c.slug !== "other" && [c.name, ...(c.keywords ?? [])].some((n) => fold(n).startsWith(q)))
    .slice(0, 4)
    .map((c) => ({ text: c.slug, label: c.name, cat: c.slug }));
  return { places, cats };
}
