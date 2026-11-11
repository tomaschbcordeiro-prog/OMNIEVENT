/**
 * Your own plans on a trip: the flight there, the hotel, a meeting, dinner with friends. Typed
 * in a line ("Flight TP1350 Lisbon to London 2 Dec 9:40") and understood as you type, or filled
 * in field by field. Pure, so it can be tested; the trip keeps them in this browser.
 */

export type PlanKind = "flight" | "train" | "bus" | "car" | "stay" | "meeting" | "meal" | "activity" | "note";

export interface TripPlan {
  id: string;
  kind: PlanKind;
  title: string;
  /** YYYY-MM-DD, local to where it happens. */
  day: string;
  /** HH:MM, local. */
  time?: string;
  /** The day it ends (a stay's check-out, a flight landing the next day). */
  endDay?: string;
  endTime?: string;
  /** Where a journey leaves from and goes to ("Lisbon", "LHR"). */
  from?: string;
  to?: string;
  /** Where it happens (a hotel, a café, an address). */
  place?: string;
  /** A flight number, a booking reference. */
  ref?: string;
  notes?: string;
  createdAt: string;
}

export const PLAN_KINDS: { kind: PlanKind; label: string; travel?: boolean }[] = [
  { kind: "flight", label: "Flight", travel: true },
  { kind: "train", label: "Train", travel: true },
  { kind: "bus", label: "Bus", travel: true },
  { kind: "car", label: "Drive", travel: true },
  { kind: "stay", label: "Stay" },
  { kind: "meeting", label: "Meeting" },
  { kind: "meal", label: "Meal" },
  { kind: "activity", label: "Activity" },
  { kind: "note", label: "Note" },
];
export const kindLabel = (k: PlanKind) => PLAN_KINDS.find((x) => x.kind === k)?.label ?? "Plan";
export const isTravel = (k: PlanKind) => !!PLAN_KINDS.find((x) => x.kind === k)?.travel;

// Words that say what a plan is (English and Portuguese).
const WORDS: [PlanKind, RegExp][] = [
  ["flight", /\b(flight|fly|flying|voo|avi[aã]o|plane|airport|aeroporto|boarding)\b/i],
  ["train", /\b(train|comboio|rail|eurostar|tgv|intercity|alfa pendular)\b/i],
  ["bus", /\b(bus|coach|autocarro|flixbus)\b/i],
  ["car", /\b(drive|driving|car|rental|taxi|uber|carro|road trip)\b/i],
  ["stay", /\b(hotel|hostel|airbnb|stay|staying|check[- ]?in|apartment|alojamento|estadia|guesthouse|b&b)\b/i],
  ["meeting", /\b(meeting|meet|call|reuni[aã]o|interview|appointment|consulta|visita ao|visit to)\b/i],
  ["meal", /\b(dinner|lunch|breakfast|brunch|restaurant|jantar|almo[cç]o|pequeno[- ]almo[cç]o|drinks|coffee|caf[eé]|tapas)\b/i],
  ["activity", /\b(tour|museum|museu|ticket|show|concert|hike|walk|class|workshop|spa|game|match)\b/i],
];
// A word saying what it is, without anything else, is no title ("Flight" → the flight's own).
const KIND_ONLY = /^(flight|voo|train|comboio|bus|autocarro|drive|car|hotel|stay|meeting|reuni[aã]o|dinner|jantar|lunch|almo[cç]o|breakfast|note)$/i;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, janeiro: 1, feb: 2, february: 2, fev: 2, fevereiro: 2, mar: 3, march: 3, março: 3, marco: 3, apr: 4, april: 4, abr: 4, abril: 4, may: 5, mai: 5, maio: 5,
  jun: 6, june: 6, junho: 6, jul: 7, july: 7, julho: 7, aug: 8, august: 8, ago: 8, agosto: 8, sep: 9, sept: 9, september: 9, set: 9, setembro: 9,
  oct: 10, october: 10, out: 10, outubro: 10, nov: 11, november: 11, novembro: 11, dec: 12, december: 12, dez: 12, dezembro: 12,
};
const MONTH = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const WEEKDAYS: Record<string, number> = { sun: 0, sunday: 0, dom: 0, domingo: 0, mon: 1, monday: 1, seg: 1, segunda: 1, tue: 2, tues: 2, tuesday: 2, ter: 2, "terça": 2, terca: 2, wed: 3, wednesday: 3, qua: 3, quarta: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, qui: 4, quinta: 4, fri: 5, friday: 5, sex: 5, sexta: 5, sat: 6, saturday: 6, "sáb": 6, sab: 6, "sábado": 6, sabado: 6 };
const WEEKDAY = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join("|");

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();

/** A month and day as a date in the year that puts it in (or nearest to) the trip. */
function dated(m: number, d: number, around: string): string | null {
  const y0 = Number(around.slice(0, 4));
  let best: string | null = null;
  for (const y of [y0 - 1, y0, y0 + 1]) {
    if (!valid(y, m, d)) continue;
    const s = ymd(y, m, d);
    if (!best || Math.abs(Date.parse(s) - Date.parse(around)) < Math.abs(Date.parse(best) - Date.parse(around))) best = s;
  }
  return best;
}

function hm(h: number, m: number, ampm?: string): string | null {
  let hh = h;
  if (ampm) {
    const pm = /p/i.test(ampm);
    if (hh < 1 || hh > 12) return null;
    hh = (hh % 12) + (pm ? 12 : 0);
  }
  return hh >= 0 && hh <= 23 && m >= 0 && m <= 59 ? `${pad(hh)}:${pad(m)}` : null;
}

export interface ParseContext {
  /** The trip's days, in order (YYYY-MM-DD). */
  days: string[];
  /** The day it goes on when none is said (the day whose "+" was tapped, or the first). */
  defaultDay: string;
}

/**
 * A plan from a line of text. Picks out what it is, the day (or days), times, a journey's
 * ends, a flight number and where it is; what's left is its title.
 */
export function parsePlan(text: string, ctx: ParseContext): Omit<TripPlan, "id" | "createdAt"> {
  let rest = ` ${text.replace(/\s+/g, " ").trim()} `;
  const cut = (re: RegExp) => {
    rest = rest.replace(re, " ");
  };
  const around = ctx.days[0] ?? ctx.defaultDay;

  // A flight number (TP1350, BA 432, U2 8123).
  let ref: string | undefined;
  const fl = rest.match(/\s([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})(?=[\s,.]|$)/);
  if (fl) {
    ref = `${fl[1]} ${fl[2]}`;
    cut(new RegExp(`\\s${fl[1]}\\s?${fl[2]}(?=[\\s,.]|$)`));
  }

  // Times: "9:40", "21h30", "15h", "8am", and a range "9:40-12:15".
  const times: string[] = [];
  const timeRe = /(?:(?<=\s)(?:at|às|as|@)\s*)?\b(\d{1,2})(?:[:h.](\d{2})|h|\s?(am|pm))(?![\d/])/gi;
  rest = rest.replace(timeRe, (m, h: string, mm: string | undefined, ap: string | undefined) => {
    if (!mm && !ap && !/h$/i.test(m)) return m;
    const t = hm(Number(h), Number(mm ?? 0), ap);
    if (!t) return m;
    times.push(t);
    return " ";
  });
  cut(/\s[-–—]\s?(?=\s)/g);

  // Days: "2-5 Dec", "Dec 2", "2 Dec", "2/12", "2026-12-02", "day 3", a weekday.
  let day: string | undefined;
  let endDay: string | undefined;
  const take = (d: string | null, end?: string | null) => {
    if (!d) return false;
    day = d;
    if (end && end > d) endDay = end;
    return true;
  };
  const iso = rest.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const range = rest.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s?(?:-|–|to|a|até)\\s?(\\d{1,2})(?:st|nd|rd|th)?\\s(?:de\\s)?(${MONTH})\\b\\.?`, "i"));
  const rangeM = rest.match(new RegExp(`\\b(${MONTH})\\.?\\s(\\d{1,2})\\s?(?:-|–|to)\\s?(\\d{1,2})\\b`, "i"));
  const dm = rest.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s(?:de\\s)?(${MONTH})\\b\\.?`, "i"));
  const md = rest.match(new RegExp(`\\b(${MONTH})\\.?\\s(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i"));
  const slash = rest.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  const nth = rest.match(/\b(?:day|dia)\s(\d{1,2})\b/i);
  const wd = rest.match(new RegExp(`\\b(${WEEKDAY})\\b\\.?`, "i"));
  const lit = (m: string) => new RegExp(m.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "i");
  // The first way of saying a day that's there (and makes a date) is the day; it leaves the text.
  const found: [RegExp | null, string | null, string?][] = [];
  if (iso && valid(+iso[1], +iso[2], +iso[3])) found.push([lit(iso[0]), iso[0]]);
  else if (range) found.push([lit(range[0]), dated(MONTHS[range[3].toLowerCase()], +range[1], around), dated(MONTHS[range[3].toLowerCase()], +range[2], around) ?? undefined]);
  else if (rangeM) found.push([lit(rangeM[0]), dated(MONTHS[rangeM[1].toLowerCase()], +rangeM[2], around), dated(MONTHS[rangeM[1].toLowerCase()], +rangeM[3], around) ?? undefined]);
  else if (dm) found.push([lit(dm[0]), dated(MONTHS[dm[2].toLowerCase()], +dm[1], around)]);
  else if (md) found.push([lit(md[0]), dated(MONTHS[md[1].toLowerCase()], +md[2], around)]);
  else if (slash && +slash[2] <= 12) found.push([lit(slash[0]), dated(+slash[2], +slash[1], around)]);
  else if (nth && ctx.days[+nth[1] - 1]) found.push([lit(nth[0]), ctx.days[+nth[1] - 1]]);
  else if (wd) {
    const want = WEEKDAYS[wd[1].toLowerCase()];
    const hit = ctx.days.find((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === want) ?? null;
    found.push([new RegExp(`\\b${wd[0].replace(/\./g, "\\.")}`, "i"), hit]);
  }
  for (const [re, d, end] of found) {
    if (take(d, end) && re) cut(re);
  }

  // What it is: said in words, or a flight number.
  let kind: PlanKind = WORDS.find(([, re]) => re.test(rest))?.[0] ?? (ref ? "flight" : "activity");
  if (ref && kind === "activity") kind = "flight";

  // A journey's ends: "Lisbon to London", "LIS → LHR", "Porto para Lisboa" (the word for the
  // journey itself goes first, so it isn't taken for a place).
  let from: string | undefined;
  let to: string | undefined;
  if (isTravel(kind)) {
    const word = WORDS.find(([k]) => k === kind)?.[1];
    if (word) cut(new RegExp(word.source, "gi"));
    const j = rest.match(/(?:\bfrom\s|\bde\s)?([A-ZÀ-Þ][\p{L}'.-]*(?:\s[A-ZÀ-Þ][\p{L}'.-]*){0,2})\s?(?:→|->|>|\bto\b|\bpara\b|–|—|-)\s?([A-ZÀ-Þ][\p{L}'.-]*(?:\s[A-ZÀ-Þ][\p{L}'.-]*){0,2})/u);
    if (j) {
      from = j[1].trim();
      to = j[2].trim();
      cut(new RegExp(j[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
    }
  }

  // Where it is: "at Café Nicola", "@ the office", "no Hotel X".
  let place: string | undefined;
  const at = rest.match(/\s(?:at|@|em|no|na)\s([^,;]+?)\s*$/i);
  if (at && !isTravel(kind)) {
    place = at[1].trim();
    cut(new RegExp(`\\s(?:at|@|em|no|na)\\s${at[1].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"));
  }

  let title = rest.replace(/\s+/g, " ").replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, "").trim();
  if (!title || KIND_ONLY.test(title)) title = isTravel(kind) && (from || to) ? `${kindLabel(kind)} to ${to ?? from}` : title ? title[0].toUpperCase() + title.slice(1) : kindLabel(kind);
  else title = title[0].toUpperCase() + title.slice(1);
  // A stay is the hotel's name; a journey's title says where it goes.
  if (kind === "stay" && place && /^(hotel|stay|airbnb)$/i.test(title)) {
    title = place;
    place = undefined;
  }

  const plan: Omit<TripPlan, "id" | "createdAt"> = { kind, title: title.slice(0, 80), day: day ?? ctx.defaultDay };
  if (times[0]) plan.time = times[0];
  if (times[1]) plan.endTime = times[1];
  if (endDay) plan.endDay = endDay;
  if (from) plan.from = from;
  if (to) plan.to = to;
  if (place) plan.place = place.slice(0, 80);
  if (ref) plan.ref = ref;
  // A stay without a check-out runs one night.
  if (kind === "stay" && !plan.endDay) {
    const d = new Date(`${plan.day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    plan.endDay = d.toISOString().slice(0, 10);
  }
  return plan;
}

/** How long it lasts, when it says ("2h 35m"). */
export function durationOf(p: Pick<TripPlan, "day" | "time" | "endDay" | "endTime">): string | null {
  if (!p.time || !p.endTime) return null;
  const a = Date.parse(`${p.day}T${p.time}:00Z`);
  const b = Date.parse(`${p.endDay ?? p.day}T${p.endTime}:00Z`);
  let min = Math.round((b - a) / 60000);
  if (min <= 0 && !p.endDay) min += 24 * 60; // past midnight
  if (min <= 0 || min > 3 * 24 * 60) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

/** The nights of a stay (check-in day to check-out day). */
export function nightsOf(p: Pick<TripPlan, "day" | "endDay">): number {
  if (!p.endDay) return 0;
  return Math.max(0, Math.round((Date.parse(`${p.endDay}T00:00:00Z`) - Date.parse(`${p.day}T00:00:00Z`)) / 86_400_000));
}

/** Where a plan is ordered within its day: timed by time; all-day first; untimed last. */
export function planSortKey(p: Pick<TripPlan, "kind" | "time">): string {
  if (p.time) return `1${p.time}`;
  return p.kind === "stay" ? "0" : "2";
}

/** A plan as calendar (iCalendar) lines, at the local time where it happens. */
export function planIcs(p: TripPlan, tripId: string, stamp: string): string[] {
  const esc = (s: string) => s.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  const d = (s: string) => s.replace(/-/g, "");
  const t = (s: string) => s.replace(":", "") + "00";
  const lines = ["BEGIN:VEVENT", `UID:${tripId}-${p.id}@omnievent`, `DTSTAMP:${stamp}`];
  if (p.time) {
    lines.push(`DTSTART:${d(p.day)}T${t(p.time)}`);
    if (p.endTime) lines.push(`DTEND:${d(p.endDay ?? p.day)}T${t(p.endTime)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${d(p.day)}`);
    const end = p.endDay && p.endDay > p.day ? p.endDay : new Date(Date.parse(`${p.day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    lines.push(`DTEND;VALUE=DATE:${d(end)}`);
  }
  const head = isTravel(p.kind) && (p.from || p.to) ? `${p.title}${p.ref && !p.title.includes(p.ref) ? ` (${p.ref})` : ""}: ${[p.from, p.to].filter(Boolean).join(" → ")}` : p.title;
  lines.push(`SUMMARY:${esc(head)}`);
  if (p.place) lines.push(`LOCATION:${esc(p.place)}`);
  const desc = [p.ref ? `Ref: ${p.ref}` : "", p.notes ?? ""].filter(Boolean).join("\n");
  if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
  lines.push("END:VEVENT");
  return lines;
}
