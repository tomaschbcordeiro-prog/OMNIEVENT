import { CATEGORIES, getCategory } from "../categories";

/**
 * Magic paste: an announcement as people actually write it (an Instagram caption, a WhatsApp
 * message, a flyer's text) read into the Studio's questions. It only fills in what it finds;
 * the organiser checks everything before publishing.
 */
export interface Extracted {
  title?: string;
  tagline?: string;
  description?: string;
  date?: string;
  time?: string;
  endTime?: string;
  free?: boolean;
  prices: number[];
  currency?: string;
  venueName?: string;
  /** What to search on the map for the place. */
  placeQuery?: string;
  ticketUrl?: string;
  organiserUrl?: string;
  website?: string;
  group?: string;
  category?: string;
  genres: string[];
  performers: string[];
  ageMin?: number;
  /** Plain-words list of what was found, to tell the organiser. */
  found: string[];
}

const MONTHS: [RegExp, number][] = [
  [/^(jan|janeiro|enero|january|janvier|gennaio)\.?$/, 1],
  [/^(fev|feb|fevereiro|febrero|february|février|fevrier|febbraio)\.?$/, 2],
  [/^(mar|março|marco|marzo|march|mars)\.?$/, 3],
  [/^(abr|apr|avr|abril|april|avril|aprile)\.?$/, 4],
  [/^(mai|may|maio|mayo|maggio)\.?$/, 5],
  [/^(jun|junho|junio|june|juin|giugno)\.?$/, 6],
  [/^(jul|julho|julio|july|juillet|juil|luglio)\.?$/, 7],
  [/^(ago|aug|agosto|august|août|aout)\.?$/, 8],
  [/^(set|sep|sept|setembro|septiembre|september|septembre|settembre)\.?$/, 9],
  [/^(out|oct|outubro|octubre|october|octobre|ottobre)\.?$/, 10],
  [/^(nov|novembro|noviembre|november|novembre)\.?$/, 11],
  [/^(dez|dec|dic|déc|dezembro|diciembre|december|décembre|decembre|dicembre)\.?$/, 12],
];
const monthOf = (w: string) => MONTHS.find(([re]) => re.test(w.toLowerCase()))?.[1];
const MONTH_WORD = "(jan(?:eiro|uary|vier)?|enero|fev(?:ereiro)?|feb(?:rero|ruary)?|février|fevrier|mar(?:ço|co|zo|ch|s)?|abr(?:il)?|apr(?:il)?|avr(?:il)?|mai(?:o)?|may(?:o)?|jun(?:ho|io|e)?|juin|jul(?:ho|io|y)?|juil(?:let)?|ago(?:sto)?|aug(?:ust)?|août|aout|set(?:embro)?|sep(?:t(?:ember|iembre|embre)?)?|out(?:ubro)?|oct(?:ubre|ober|obre)?|nov(?:embro|iembre|ember|embre)?|dez(?:embro)?|dec(?:ember)?|dic(?:iembre)?|déc(?:embre)?|decembre)\\.?";
const WEEKDAYS: [RegExp, number][] = [
  [/^(domingo|sunday|dimanche|sun)$/, 0],
  [/^(segunda(?:-feira)?|lunes|monday|lundi|mon)$/, 1],
  [/^(terça(?:-feira)?|terca(?:-feira)?|martes|tuesday|mardi|tue)$/, 2],
  [/^(quarta(?:-feira)?|miércoles|miercoles|wednesday|mercredi|wed)$/, 3],
  [/^(quinta(?:-feira)?|jueves|thursday|jeudi|thu)$/, 4],
  [/^(sexta(?:-feira)?|viernes|friday|vendredi|fri)$/, 5],
  [/^(sábado|sabado|saturday|samedi|sat)$/, 6],
];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && new Date(y, m - 1, d).getDate() === d;

/** A day and month without a year: the next time it comes round. */
function nextOf(day: number, month: number, now: Date, year?: number): string | undefined {
  if (year) return valid(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : undefined;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const y of [now.getFullYear(), now.getFullYear() + 1]) {
    if (!valid(y, month, day)) continue;
    if (new Date(y, month - 1, day) >= today) return `${y}-${pad(month)}-${pad(day)}`;
  }
  return undefined;
}

function findDate(text: string, now: Date): string | undefined {
  const t = text.toLowerCase();
  let m = t.match(/\b(20\d\d)-(\d{2})-(\d{2})\b/);
  if (m && valid(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  // 14 de dezembro (de 2026), 14 dez, 14th December 2026
  m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|º|ª)?\\s*(?:de\\s+)?${MONTH_WORD}(?:\\s*(?:de\\s+)?,?\\s*(20\\d\\d))?\\b`, "i"));
  if (m && monthOf(m[2])) return nextOf(+m[1], monthOf(m[2])!, now, m[3] ? +m[3] : undefined);
  // December 14(th), 2026
  m = t.match(new RegExp(`\\b${MONTH_WORD}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(20\\d\\d))?\\b`, "i"));
  if (m && monthOf(m[1])) return nextOf(+m[2], monthOf(m[1])!, now, m[3] ? +m[3] : undefined);
  // 14/12(/2026), 14.12, 14-12-26 (day first; a first number over 12 can't be the month)
  m = t.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|20\d\d))?\b/);
  if (m) {
    let [d, mo] = [+m[1], +m[2]];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : undefined;
    const r = nextOf(d, mo, now, y);
    if (r) return r;
  }
  // today / tomorrow / next Saturday
  // Whole words, accents included ("amanhã" ends in a letter \b doesn't know).
  const word = (alts: string) => new RegExp(`(?<![\\p{L}])(?:${alts})(?![\\p{L}])`, "u");
  if (word("today|hoje|hoy|aujourd'hui|tonight|esta noite").test(t)) return ymd(now);
  if (word("tomorrow|amanhã|amanha|mañana|demain").test(t)) return ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  for (const w of t.split(/[^a-zà-ÿ-]+/)) {
    const wd = WEEKDAYS.find(([re]) => re.test(w))?.[1];
    if (wd === undefined) continue;
    const ahead = (wd - now.getDay() + 7) % 7;
    return ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead));
  }
  return undefined;
}

/** Times written as 21:30, 21h30, 21h, 9pm or 9:30 pm, in order. */
function findTimes(text: string): string[] {
  const out: { at: number; v: string }[] = [];
  const add = (at: number, h: number, mi: number) => {
    if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) out.push({ at, v: `${pad(h)}:${pad(mi)}` });
  };
  for (const m of text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm|a\.m\.|p\.m\.)/gi)) {
    let h = +m[1] % 12;
    if (/^p/i.test(m[3])) h += 12;
    add(m.index!, h, m[2] ? +m[2] : 0);
  }
  for (const m of text.matchAll(/\b([01]?\d|2[0-3])(?::|h|H)([0-5]\d)\b(?!\s?(?:am|pm))/g)) add(m.index!, +m[1], +m[2]);
  for (const m of text.matchAll(/\b([01]?\d|2[0-3])\s?h\b(?!\d)/gi)) add(m.index!, +m[1], 0);
  return [...new Map(out.sort((a, b) => a.at - b.at).map((x) => [x.v, x])).values()].map((x) => x.v);
}

const CURRENCY: Record<string, string> = { "€": "EUR", eur: "EUR", euro: "EUR", euros: "EUR", "£": "GBP", gbp: "GBP", $: "USD", usd: "USD", "r$": "BRL", brl: "BRL", chf: "CHF" };

function findPrices(text: string): { prices: number[]; currency?: string } {
  const prices: number[] = [];
  let currency: string | undefined;
  const take = (sym: string, amount: string) => {
    const n = Number(amount.replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 100000) return;
    prices.push(n);
    currency ??= CURRENCY[sym.toLowerCase()];
  };
  for (const m of text.matchAll(/(r\$|€|£|\$)\s?(\d{1,5}(?:[.,]\d{1,2})?)/gi)) take(m[1], m[2]);
  for (const m of text.matchAll(/\b(\d{1,5}(?:[.,]\d{1,2})?)\s?(€|eur\b|euros?\b|£|gbp\b|usd\b|brl\b|chf\b)/gi)) take(m[2], m[1]);
  return { prices: [...new Set(prices)].sort((a, b) => a - b), currency };
}

const FREE_RE = /\b(free entry|free admission|free\b|grátis|gratis|gratuito|gratuita|entrada livre|entrada gratuita|entrée libre|gratuit|ingresso gratuito)/i;
const TICKET_HOST = /(ticket|bilhete|eventbrite|bol\.pt|ticketline|blueticket|shotgun|dice\.fm|ra\.co|seetickets|feverup|entradas|sympla|billetto|universe\.com|tix|lu\.ma|meetup\.com)/i;

function findLinks(text: string) {
  // Full links, and bare ones like instagram.com/name (never the domain of an email address).
  const urls = [...text.matchAll(/(?<![@\w.])((?:https?:\/\/|www\.)[^\s<>"')]+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|pt|es|fr|de|it|uk|io|co|br|fm|me|ly|app|events?)\/[^\s<>"')]*)/gi)]
    .map((m) => m[1].replace(/[.,;:!?]+$/, ""))
    .map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`));
  const ticketUrl = urls.find((u) => TICKET_HOST.test(u));
  const organiserUrl = urls.find((u) => /instagram\.com|facebook\.com|tiktok\.com/i.test(u));
  const website = urls.find((u) => u !== ticketUrl && u !== organiserUrl);
  return { ticketUrl, organiserUrl, website, urls };
}

const PLACE_RE = [
  /(?:📍|📌)\s*([^\n]+)/u,
  /\b(?:local|venue|where|onde|lugar|lieu|location|morada|address)\s*[:\-–]\s*([^\n]+)/i,
  /(?:^|\s)@\s?([A-ZÀ-Ý][^\n,.!?#@]{2,60})/u,
  /\b(?:at|no|na|em|en|au|à)\s+((?:[A-ZÀ-Ý][\wÀ-ÿ'’&-]*\.?\s?){1,6})/u,
];

function findPlace(lines: string[]): { venueName?: string; placeQuery?: string } {
  for (const re of PLACE_RE) {
    for (const line of lines) {
      const m = line.match(re);
      if (!m) continue;
      const raw = m[1].replace(/https?:\/\/\S+/g, "").replace(/[#*_~|]+/g, "").trim().replace(/[.!]+$/, "");
      if (raw.length < 3 || /^\d/.test(raw)) continue;
      const [name, ...rest] = raw.split(/\s*[,–—|]\s*/);
      return { venueName: name.trim().slice(0, 120), placeQuery: [name, ...rest].join(", ").slice(0, 160) };
    }
  }
  return {};
}

const norm = (s: string) => ` ${s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9#+]+/g, " ")} `;

function findCategory(text: string): { group?: string; category?: string } {
  const t = norm(text);
  let best: { slug: string; score: number } | undefined;
  for (const c of CATEGORIES) {
    if (!c.active || c.slug === "other") continue;
    const words = [c.name, ...(c.keywords ?? [])].map((w) => norm(w).trim()).filter((w) => w.length > 2);
    const hits = words.filter((w) => t.includes(` ${w} `)).length;
    if (!hits) continue;
    const score = hits * (c.parent ? 3 : 2);
    if (!best || score > best.score) best = { slug: c.slug, score };
  }
  if (!best) return {};
  const c = getCategory(best.slug)!;
  return c.parent ? { group: c.parent, category: c.slug } : { group: c.slug };
}

function findPerformers(text: string): string[] {
  const m = text.match(/\b(?:line-?up|cartaz|artistas|artists|com|with|feat\.?|ft\.?|con|avec)\s*[:\-–]?\s*([^\n.!?]+)/i);
  if (!m) return [];
  return m[1]
    .split(/\s*(?:,|&|\+|\/|\be\b|\band\b|\by\b|\bet\b)\s*/i)
    .map((s) => s.replace(/[#@*_]+/g, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 60 && /^[\p{Lu}0-9]/u.test(s))
    .slice(0, 8);
}

function findAge(text: string): number | undefined {
  const m = text.match(/\b(21|18|16|12|6)\s?\+|\b(?:maiores de|mayores de|over|plus de|\+)\s?(21|18|16|12|6)\b/i);
  return m ? Number(m[1] ?? m[2]) : undefined;
}

/** Title Case for a shouted first line, keeping short words small. */
function calm(s: string): string {
  const letters = s.replace(/[^\p{L}]/gu, "");
  if (letters.length < 6 || letters !== letters.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|\s|[-–(])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/\b(De|Do|Da|Dos|Das|E|Of|The|And|In|At|No|Na|Em|A|O|Y|La|El|Le|Les)\b/g, (w, _a, i) => (i === 0 ? w : w.toLowerCase()));
}

const decor = /^[\s\p{Extended_Pictographic}\p{Emoji_Presentation}‍️*#•·|>-]+|[\s\p{Extended_Pictographic}\p{Emoji_Presentation}‍️*•·|]+$/gu;

export function extractEvent(text: string, now = new Date()): Extracted {
  const clean = text.replace(/[​‌‎‏]/g, "").replace(/\r\n?/g, "\n").trim();
  const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: Extracted = { prices: [], genres: [], performers: [], found: [] };
  if (!lines.length) return out;

  // The name: the first line that is words, not a date, a link or hashtags.
  const titleLine = lines.find((l) => {
    const s = l.replace(decor, "").replace(/#[\p{L}\d_]+/gu, "").trim();
    return s.length >= 3 && !/^(https?:\/\/|www\.)/i.test(s) && /\p{L}{3}/u.test(s) && !/^(\d|📍|📅|🕘|🎟)/u.test(l);
  });
  if (titleLine) {
    const title = calm(titleLine.replace(decor, "").replace(/#[\p{L}\d_]+/gu, "").replace(/\s{2,}/g, " ").trim()).slice(0, 120);
    if (title.length >= 3) {
      out.title = title;
      out.found.push("name");
    }
  }
  const rest = lines.filter((l) => l !== titleLine);
  const body = rest.filter((l) => !/^((https?:\/\/|www\.)\S+|(#[\p{L}\d_]+\s*)+)$/iu.test(l)).join("\n").trim();
  if (body.length >= 20) {
    out.description = body.slice(0, 5000);
    out.found.push("description");
  }

  const date = findDate(clean, now);
  if (date) {
    out.date = date;
    out.found.push("date");
  }
  const times = findTimes(clean);
  if (times[0]) {
    out.time = times[0];
    out.found.push("time");
    // A range ("21h-23h", "das 21:00 às 23:30") gives the end.
    const range = clean.match(/(\d{1,2}(?:[:h]\d{2}|h)?\s?(?:am|pm)?)\s*(?:-|–|—|to|até|às|as|a|à|till|until)\s*(\d{1,2}(?:[:h]\d{2}|h)\s?(?:am|pm)?|\d{1,2}\s?(?:am|pm))/i);
    if (range && times[1]) out.endTime = times[1];
  }

  // A price makes it paid, even if "free" appears somewhere ("free before midnight, €10 after").
  const { prices, currency } = findPrices(clean);
  const paid = prices.filter((p) => p > 0);
  if (paid.length) {
    out.prices = paid;
    out.currency = currency;
    out.free = false;
    out.found.push(paid.length > 1 ? "prices" : "price");
  } else if (FREE_RE.test(clean)) {
    out.free = true;
    out.found.push("free entry");
  }

  const place = findPlace(lines);
  if (place.venueName) {
    Object.assign(out, place);
    out.found.push("place");
  }
  const links = findLinks(clean);
  out.ticketUrl = links.ticketUrl;
  out.organiserUrl = links.organiserUrl;
  out.website = links.website;
  if (links.urls.length) out.found.push(links.urls.length > 1 ? "links" : "a link");

  const cat = findCategory(clean);
  if (cat.group) {
    Object.assign(out, cat);
    out.found.push("kind of event");
  }
  out.genres = [...new Set([...clean.matchAll(/#([\p{L}][\p{L}\d_]{1,29})/gu)].map((m) => m[1].replace(/_/g, " ").toLowerCase()))].slice(0, 6);
  if (out.genres.length) out.found.push("styles");
  out.performers = findPerformers(clean);
  if (out.performers.length) out.found.push("line-up");
  out.ageMin = findAge(clean);
  if (out.ageMin) out.found.push("age");
  return out;
}
