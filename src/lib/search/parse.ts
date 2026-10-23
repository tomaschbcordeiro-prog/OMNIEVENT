import { CATEGORIES, getCategory } from "../categories";
import { ALL_DESTINATIONS } from "../destinations";
import type { Destination, ParsedQuery, SearchFilters } from "../types";

/**
 * Natural-language → structured filters.
 *
 * Design rule: every extracted piece becomes a visible, removable "interpretation"
 * chip, and anything uncertain becomes an `ambiguities` suggestion instead of a
 * silently applied filter.
 */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_ABBR: Record<string, number> = {};
MONTHS.forEach((m, i) => {
  MONTH_ABBR[m] = i;
  MONTH_ABBR[m.slice(0, 3)] = i;
  if (m.length > 4) MONTH_ABBR[m.slice(0, 4)] = i; // "sept"
});

const STOP = new Set([
  "find", "show", "me", "search", "for", "the", "a", "an", "and", "or", "of", "events", "event", "things", "to", "do",
  "what", "whats", "what's", "is", "are", "on", "happening", "i", "can", "buy", "tickets", "ticket", "with", "please",
  "some", "any", "all", "list", "at", "my", "get", "looking", "want", "going", "around", "near", "in", "this", "next",
  "between", "from", "until", "till", "by", "e", "y", "de", "em", "en", "no", "na", "que",
]);

const CURRENCY_WORDS: Record<string, string> = {
  "$": "USD", usd: "USD", dollar: "USD", dollars: "USD", "us$": "USD",
  "€": "EUR", eur: "EUR", euro: "EUR", euros: "EUR",
  "£": "GBP", gbp: "GBP", pound: "GBP", pounds: "GBP",
  "¥": "JPY", jpy: "JPY", yen: "JPY",
  "r$": "BRL", brl: "BRL", reais: "BRL", real: "BRL",
  "a$": "AUD", aud: "AUD", "c$": "CAD", cad: "CAD", chf: "CHF", mxn: "MXN",
};

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

function lev(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// ---------- lookup tables (built once) ----------
const destIndex = new Map<string, Destination>();
for (const d of ALL_DESTINATIONS) {
  for (const name of [d.name, ...(d.aliases ?? [])]) {
    const k = norm(name).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    // Cities win over countries with the same name (e.g. Singapore, Monaco, Hong Kong).
    const existing = destIndex.get(k);
    if (!existing || (existing.kind !== "city" && d.kind === "city")) destIndex.set(k, d);
  }
}
const catIndex = new Map<string, string>();
for (const c of CATEGORIES) {
  for (const k of [c.name, c.slug.replace(/-/g, " "), ...(c.keywords ?? [])]) {
    const key = norm(k).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    if (key && !catIndex.has(key)) catIndex.set(key, c.slug);
  }
}
// Plural/singular convenience
for (const [k, v] of [...catIndex]) if (!k.endsWith("s") && !catIndex.has(`${k}s`)) catIndex.set(`${k}s`, v);

const fmtYMD = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const shortFmt = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "Today" as a UTC-midnight Date for the given time zone. */
function todayIn(now: Date, tz?: string): Date {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${s}T00:00:00Z`);
}

function parseDateToken(text: string, today: Date, fallbackMonth?: number): Date | undefined {
  const t = text.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/); // dd/mm(/yyyy) — European order
  if (m) return withYear(today, +m[2] - 1, +m[1], m[3] ? +m[3] : undefined);
  m = t.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/);
  if (m && MONTH_ABBR[m[1]] !== undefined) return withYear(today, MONTH_ABBR[m[1]], +m[2], m[3] ? +m[3] : undefined);
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)\.?(?:,?\s*(\d{4}))?$/);
  if (m && MONTH_ABBR[m[2]] !== undefined) return withYear(today, MONTH_ABBR[m[2]], +m[1], m[3] ? +m[3] : undefined);
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
  if (m && fallbackMonth !== undefined) return withYear(today, fallbackMonth, +m[1]);
  return undefined;
}

function withYear(today: Date, month: number, day: number, year?: number): Date {
  if (year) return new Date(Date.UTC(year < 100 ? 2000 + year : year, month, day));
  let d = new Date(Date.UTC(today.getUTCFullYear(), month, day));
  if (d.getTime() < today.getTime() - 86400000 * 7) d = new Date(Date.UTC(today.getUTCFullYear() + 1, month, day));
  return d;
}

function monthRange(today: Date, month: number, forceNextYear = false): [Date, Date] {
  let y = today.getUTCFullYear();
  if (forceNextYear || month < today.getUTCMonth()) y++;
  return [new Date(Date.UTC(y, month, 1)), new Date(Date.UTC(y, month + 1, 0))];
}

export interface ParseOptions {
  now?: Date;
  timeZone?: string;
}

export function parseQuery(input: string, opts: ParseOptions = {}): ParsedQuery {
  const now = opts.now ?? new Date();
  const today = todayIn(now, opts.timeZone);
  const filters: SearchFilters = {};
  const interpretation: ParsedQuery["interpretation"] = [];
  const ambiguities: string[] = [];

  let text = ` ${norm(input).replace(/[“”"!?]/g, " ").replace(/\s+/g, " ").trim()} `;
  const consume = (re: RegExp) => {
    text = text.replace(re, " ");
  };

  // ---------------- price ----------------
  const cur = "(\\$|€|£|¥|r\\$|a\\$|c\\$|us\\$)?";
  const curWord = "(usd|eur|gbp|jpy|brl|aud|cad|chf|mxn|dollars?|euros?|pounds?|yen|reais|€|\\$|£)?";
  const betweenPrice = new RegExp(`(?:between|from)\\s+${cur}\\s*(\\d+(?:[.,]\\d+)?)\\s*${curWord}\\s+(?:and|to|-)\\s+${cur}\\s*(\\d+(?:[.,]\\d+)?)\\s*${curWord}`);
  let pm = text.match(betweenPrice);
  if (pm && (pm[1] || pm[3] || pm[4] || pm[6])) {
    filters.minPrice = parseFloat(pm[2].replace(",", "."));
    filters.maxPrice = parseFloat(pm[5].replace(",", "."));
    const c = pm[1] || pm[3] || pm[4] || pm[6];
    if (c) filters.currency = CURRENCY_WORDS[c];
    consume(betweenPrice);
  } else {
    const maxRe = new RegExp(`(?:under|below|less than|cheaper than|max(?:imum)?|up to|at most|<|até|menos de|menos que|hasta|moins de|unter)\\s*${cur}\\s*(\\d+(?:[.,]\\d+)?)\\s*${curWord}`);
    pm = text.match(maxRe);
    if (pm) {
      filters.maxPrice = parseFloat(pm[2].replace(",", "."));
      const c = pm[1] || pm[3];
      if (c) filters.currency = CURRENCY_WORDS[c];
      consume(maxRe);
    }
    const minRe = new RegExp(`(?:over|above|more than|at least|>)\\s*${cur}\\s*(\\d+(?:[.,]\\d+)?)\\s*${curWord}`);
    pm = text.match(minRe);
    if (pm) {
      filters.minPrice = parseFloat(pm[2].replace(",", "."));
      const c = pm[1] || pm[3];
      if (c) filters.currency = CURRENCY_WORDS[c];
      consume(minRe);
    }
  }
  if (filters.minPrice != null || filters.maxPrice != null) {
    const sym = filters.currency ?? "";
    const label =
      filters.minPrice != null && filters.maxPrice != null
        ? `${sym} ${filters.minPrice}–${filters.maxPrice}`
        : filters.maxPrice != null
          ? `Under ${sym} ${filters.maxPrice}`
          : `Over ${sym} ${filters.minPrice}`;
    interpretation.push({ key: "price", label: label.replace(/\s+/g, " ").trim() });
    if (!filters.currency) ambiguities.push("No currency given — prices are compared in each event's own currency. Add €, $ or £ to compare across currencies.");
  }
  if (/\b(free|gratis|gratuito|gratuit|kostenlos)\b/.test(text) && !/\bfree (?:of|from)\b/.test(text)) {
    filters.access = "free";
    interpretation.push({ key: "access", label: "Free entry" });
    consume(/\b(free|gratis|gratuito|gratuit|kostenlos)\b/);
  }
  if (/\bcan buy tickets?\b|\bon sale\b|\bavailable tickets\b/.test(text)) {
    filters.status = ["on_sale"];
    interpretation.push({ key: "status", label: "On sale now" });
    consume(/\bcan buy tickets?(?: for)?\b|\bon sale\b|\bavailable tickets\b/);
  }

  // ---------------- dates ----------------
  const setRange = (from: Date, to: Date, label: string) => {
    filters.from = fmtYMD(from);
    filters.to = fmtYMD(to);
    interpretation.push({ key: "date", label });
  };
  const dateWord = "(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|[a-z]+\\.? \\d{1,2}(?:st|nd|rd|th)?(?:,? \\d{4})?|\\d{1,2}(?:st|nd|rd|th)? (?:of )?[a-z]+(?:,? \\d{4})?|\\d{1,2}(?:st|nd|rd|th)?)";
  const rangeRe = new RegExp(`(?:between|from)\\s+${dateWord}\\s+(?:and|to|until|-)\\s+${dateWord}`);
  const rm = text.match(rangeRe);
  let dateDone = false;
  if (rm) {
    const a = parseDateToken(rm[1], today);
    const fallbackMonth = a?.getUTCMonth();
    const b = parseDateToken(rm[2], today, fallbackMonth);
    if (a && b && b >= a) {
      setRange(a, b, `${shortFmt(fmtYMD(a))} – ${shortFmt(fmtYMD(b))}`);
      consume(rangeRe);
      dateDone = true;
    }
  }
  if (!dateDone) {
    const dow = today.getUTCDay(); // 0 Sun
    const rules: [RegExp, () => [Date, Date, string]][] = [
      [/\b(today|hoje|hoy|aujourd'hui|heute)\b/, () => [today, today, "Today"]],
      [/\btonight\b/, () => [today, today, "Tonight"]],
      [/\b(tomorrow|amanha|mañana|manana|demain|morgen)\b/, () => [addDays(today, 1), addDays(today, 1), "Tomorrow"]],
      [/\bnext weekend\b/, () => {
        const sat = addDays(today, ((6 - dow + 7) % 7 || 7) + 7);
        return [addDays(sat, -1), addDays(sat, 1), "Next weekend"];
      }],
      [/\b(this weekend|weekend|fim de semana|fin de semana|ce week-end)\b/, () => {
        if (dow === 0) return [today, today, "This weekend"];
        if (dow === 6) return [today, addDays(today, 1), "This weekend"];
        const fri = addDays(today, 5 - dow);
        return [fri < today ? today : fri, addDays(today, 7 - dow), "This weekend"];
      }],
      [/\bnext week\b/, () => {
        const mon = addDays(today, ((8 - dow) % 7) || 7);
        return [mon, addDays(mon, 6), "Next week"];
      }],
      [/\bthis week\b/, () => [today, addDays(today, (7 - dow) % 7), "This week"]],
      [/\bnext month\b/, () => {
        const [a, b] = monthRange(today, (today.getUTCMonth() + 1) % 12, today.getUTCMonth() === 11);
        return [a, b, a.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })];
      }],
      [/\bthis month\b/, () => [today, new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)), "This month"]],
    ];
    for (const [re, fn] of rules) {
      if (re.test(text)) {
        const [a, b, label] = fn();
        setRange(a, b, label);
        consume(re);
        dateDone = true;
        break;
      }
    }
  }
  // Single explicit date: "on november 10", "nov 10"
  if (!dateDone) {
    const single = text.match(/\b(?:on\s+)?([a-z]{3,9}\.? \d{1,2}(?:st|nd|rd|th)?|\d{1,2}(?:st|nd|rd|th)? (?:of )?[a-z]{3,9}|\d{4}-\d{2}-\d{2})\b/);
    if (single) {
      const d = parseDateToken(single[1], today);
      if (d) {
        setRange(d, d, shortFmt(fmtYMD(d)));
        consume(new RegExp(`\\b(?:on\\s+)?${single[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
        dateDone = true;
      }
    }
  }
  // Month names: "in march", "march"
  if (!dateDone) {
    const mm = text.match(/\b(?:in\s+)?(next\s+)?(january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\b/);
    if (mm) {
      const [a, b] = monthRange(today, MONTH_ABBR[mm[2]], !!mm[1] && MONTH_ABBR[mm[2]] <= today.getUTCMonth());
      setRange(a, b, a.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }));
      consume(new RegExp(`\\b(?:in\\s+)?(?:next\\s+)?${mm[2]}\\b`));
      dateDone = true;
    }
  }

  // ---------------- categories (longest n-gram first) ----------------
  const cats: string[] = [];
  let family = false;
  for (let n = 3; n >= 1; n--) {
    const words = text.trim().split(" ").filter(Boolean);
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n).join(" ");
      if (!gram || STOP.has(gram)) continue;
      if (/^(family|families|kids|children|child|familia|niños|enfants|kinder)$/.test(gram)) {
        family = true;
        text = text.replace(new RegExp(`\\b${gram}\\b`), " ");
        continue;
      }
      const slug = catIndex.get(gram);
      if (slug && !cats.includes(slug)) {
        cats.push(slug);
        text = text.replace(new RegExp(`\\b${gram.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`), " ");
      }
    }
  }
  // A subcategory + its own group ("musicals" + "theatre") → keep the more specific.
  const finalCats = cats.filter((c) => !cats.some((o) => o !== c && getCategory(o)?.parent === c));
  if (finalCats.length) {
    filters.categories = finalCats;
    interpretation.push({ key: "categories", label: finalCats.map((c) => getCategory(c)?.name ?? c).join(" + ") });
  }
  if (family) {
    filters.family = true;
    interpretation.push({ key: "family", label: "Family-friendly" });
  }

  // ---------------- location ----------------
  let place: Destination | undefined;
  let placeGram = "";
  const words = text.trim().split(" ").filter(Boolean);
  outer: for (let n = 4; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n).join(" ");
      const d = destIndex.get(gram);
      if (d && !(n === 1 && STOP.has(gram))) {
        place = d;
        placeGram = gram;
        break outer;
      }
    }
  }
  if (!place) {
    // typo tolerance: single words ≥5 chars, distance ≤ 1 (≤2 for long words)
    for (const w of words) {
      if (w.length < 5 || STOP.has(w)) continue;
      let best: { d: Destination; k: string; dist: number } | undefined;
      for (const [k, d] of destIndex) {
        if (k.includes(" ") || Math.abs(k.length - w.length) > 2) continue;
        const dist = lev(w, k);
        if (dist <= (w.length >= 8 ? 2 : 1) && (!best || dist < best.dist)) best = { d, k, dist };
      }
      if (best) {
        place = best.d;
        placeGram = w;
        ambiguities.push(`Interpreted “${w}” as ${best.d.name}.`);
        break;
      }
    }
  }
  if (place) {
    text = text.replace(new RegExp(`\\b(?:in|near|around|at)?\\s*${placeGram.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`), " ");
    if (place.kind === "city") filters.city = place.id;
    else if (place.kind === "country") filters.country = place.countryCode;
    else if (place.kind === "continent") filters.continent = place.id;
    interpretation.push({ key: "place", label: place.kind === "city" ? `${place.name}, ${place.country}` : place.name });
  }
  if (/\bnear me\b|\bnearby\b|\bperto de mim\b|\bcerca de mi\b/.test(text)) {
    ambiguities.push("“Near me” needs your location — use the locate button (optional, never stored on our servers).");
    consume(/\bnear me\b|\bnearby\b|\bperto de mim\b|\bcerca de mi\b/);
  }

  // ---------------- seasons (hemisphere-aware) ----------------
  const sm = text.match(/\b(?:(next|this)\s+)?(spring|summer|autumn|fall|winter)\b/);
  if (sm && !filters.from) {
    const southern = !!place?.southern;
    const north: Record<string, number> = { spring: 2, summer: 5, autumn: 8, fall: 8, winter: 11 };
    let startMonth = north[sm[2]];
    if (southern) startMonth = (startMonth + 6) % 12;
    let y = today.getUTCFullYear();
    const endTest = new Date(Date.UTC(y, startMonth + 3, 0));
    if (endTest < today || sm[1] === "next") {
      if (new Date(Date.UTC(y, startMonth, 1)) <= today) y++;
    }
    const a = new Date(Date.UTC(y, startMonth, 1));
    const b = new Date(Date.UTC(y, startMonth + 3, 0));
    setRange(a, b, `${sm[2][0].toUpperCase()}${sm[2].slice(1)} ${a.getUTCFullYear()} (${a.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}–${b.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })})`);
    if (place) ambiguities.push(`Seasons use ${southern ? "southern" : "northern"}-hemisphere months for ${place.name}.`);
    else ambiguities.push("Seasons use northern-hemisphere months. Add a place for local seasons.");
    consume(/\b(?:(next|this)\s+)?(spring|summer|autumn|fall|winter)\b/);
  }

  // ---------------- residual free text ----------------
  const residual = text
    .split(" ")
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w))
    .join(" ")
    .trim();
  if (residual) filters.q = residual;

  return { filters, interpretation, ambiguities, residual };
}
