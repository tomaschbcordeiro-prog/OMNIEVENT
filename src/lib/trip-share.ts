/**
 * Everything a trip holds, and how several people change it at once.
 *
 * A trip is its route and plans (stops, flights, stays, events), plus what a trip needs beyond
 * the route: money (a budget, every cost with who paid and who shares it), lists (packing,
 * things to do before leaving, documents), the people travelling and the contacts that matter.
 *
 * Planned together, a trip lives on the server and each device keeps a copy. Changes travel as
 * small operations on single items ("this expense now reads…", "that checklist item is gone"),
 * so two people editing different things never overwrite each other; on the same item, the
 * last change wins. Pure: used by the browser and the server alike, and tested.
 */
import type { TripPlan, PlanKind } from "./trip-plans";
import type { TripStop } from "./trip";
import { convert } from "./currency";

// ---------------------------------------------------------------- what a trip holds

export type ExpenseCategory = "transport" | "stay" | "food" | "activities" | "shopping" | "other";
export const EXPENSE_CATEGORIES: { id: ExpenseCategory; label: string; emoji: string }[] = [
  { id: "transport", label: "Getting around", emoji: "✈️" },
  { id: "stay", label: "Places to stay", emoji: "🛏️" },
  { id: "food", label: "Food and drink", emoji: "🍽️" },
  { id: "activities", label: "Tickets and activities", emoji: "🎟️" },
  { id: "shopping", label: "Shopping", emoji: "🛍️" },
  { id: "other", label: "Other", emoji: "💡" },
];

export interface Expense {
  id: string;
  title: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  /** YYYY-MM-DD. */
  day?: string;
  /** The traveller who paid. */
  paidBy?: string;
  /** Who shares it (traveller ids); everyone when empty. */
  split?: string[];
  /** Still an estimate (not booked or paid yet). */
  estimate?: boolean;
  /** The booking or event it is the price of. */
  planId?: string;
  eventId?: string;
  createdAt: string;
}

export type ListKind = "packing" | "todo" | "documents";
export const LISTS: { id: ListKind; label: string; emoji: string; blurb: string }[] = [
  { id: "todo", label: "Before you go", emoji: "✅", blurb: "Bookings, papers, the bank, the phone" },
  { id: "packing", label: "Packing", emoji: "🧳", blurb: "What goes in the bag" },
  { id: "documents", label: "Documents", emoji: "🛂", blurb: "Passports, insurance, tickets" },
];

export interface CheckItem {
  id: string;
  list: ListKind;
  text: string;
  done?: boolean;
  /** The traveller who takes care of it. */
  who?: string;
  /** YYYY-MM-DD: by when (an expiry date, for a document). */
  due?: string;
  note?: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  name: string;
  /** "Hotel", "Guide", "Insurance", "Emergency"… */
  role?: string;
  phone?: string;
  email?: string;
  note?: string;
}

export interface Traveller {
  id: string;
  name: string;
  emoji?: string;
  /** The member's id, when this traveller plans the trip on Mundivi too. */
  member?: string;
}

/** An event on the trip, with what it looked like when it was added. */
export interface TripEventItem {
  id: string;
  snap?: Record<string, unknown>;
}

/** Everything about a trip that travellers share (the device's own bits stay out). */
export interface TripContent {
  name: string;
  start?: string;
  end?: string;
  emoji?: string;
  notes?: string;
  interests?: string[];
  currency?: string;
  budget?: number;
  stops: TripStop[];
  plans: TripPlan[];
  events: TripEventItem[];
  expenses: Expense[];
  checklist: CheckItem[];
  contacts: Contact[];
  travellers: Traveller[];
}

export const FIELDS = ["name", "start", "end", "emoji", "notes", "interests", "currency", "budget"] as const;
export type Field = (typeof FIELDS)[number];
export const COLLS = ["stops", "plans", "events", "expenses", "checklist", "contacts", "travellers"] as const;
export type Coll = (typeof COLLS)[number];
/** Collections whose order means something (the route, the events as added, the lists). */
const ORDERED: Coll[] = ["stops", "events", "checklist", "travellers"];

export type Op =
  | { t: "set"; f: Field; v: unknown }
  | { t: "put"; c: Coll; item: { id: string } & Record<string, unknown> }
  | { t: "del"; c: Coll; id: string }
  | { t: "order"; c: Coll; ids: string[] };

/** The trip as kept on a device (the parts that matter here). */
export interface TripLike {
  name: string;
  start?: string;
  end?: string;
  emoji?: string;
  notes?: string;
  interests?: string[];
  currency?: string;
  budget?: number;
  stops?: TripStop[];
  plans?: TripPlan[];
  eventIds: string[];
  snaps?: Record<string, unknown>;
  expenses?: Expense[];
  checklist?: CheckItem[];
  contacts?: Contact[];
  travellers?: Traveller[];
}

export function contentOf(t: TripLike): TripContent {
  return {
    name: t.name,
    ...(t.start ? { start: t.start } : {}),
    ...(t.end ? { end: t.end } : {}),
    ...(t.emoji ? { emoji: t.emoji } : {}),
    ...(t.notes ? { notes: t.notes } : {}),
    ...(t.interests?.length ? { interests: t.interests } : {}),
    ...(t.currency ? { currency: t.currency } : {}),
    ...(t.budget != null ? { budget: t.budget } : {}),
    stops: t.stops ?? [],
    plans: t.plans ?? [],
    events: t.eventIds.map((id) => (t.snaps?.[id] ? { id, snap: t.snaps[id] as Record<string, unknown> } : { id })),
    expenses: t.expenses ?? [],
    checklist: t.checklist ?? [],
    contacts: t.contacts ?? [],
    travellers: t.travellers ?? [],
  };
}

/** The device's trip with the shared content in place (its own bits kept). */
export function withContent<T extends TripLike>(t: T, c: TripContent): T {
  const snaps: Record<string, unknown> = {};
  for (const e of c.events) if (e.snap) snaps[e.id] = e.snap;
  return {
    ...t,
    name: c.name,
    start: c.start,
    end: c.end,
    emoji: c.emoji,
    notes: c.notes,
    interests: c.interests,
    currency: c.currency,
    budget: c.budget,
    stops: c.stops,
    plans: c.plans,
    eventIds: c.events.map((e) => e.id),
    snaps,
    expenses: c.expenses,
    checklist: c.checklist,
    contacts: c.contacts,
    travellers: c.travellers,
  };
}

// ---------------------------------------------------------------- changes

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function applyOps(c: TripContent, ops: Op[]): TripContent {
  const out: TripContent = { ...c };
  for (const op of ops) {
    if (op.t === "set") {
      const o = out as unknown as Record<string, unknown>;
      if (op.v === undefined || op.v === null || op.v === "") delete o[op.f];
      else o[op.f] = op.v;
    } else if (op.t === "put") {
      const list = out[op.c] as { id: string }[];
      const i = list.findIndex((x) => x.id === op.item.id);
      (out as unknown as Record<Coll, unknown[]>)[op.c] = i < 0 ? [...list, op.item] : list.map((x, j) => (j === i ? op.item : x));
    } else if (op.t === "del") {
      (out as unknown as Record<Coll, unknown[]>)[op.c] = (out[op.c] as { id: string }[]).filter((x) => x.id !== op.id);
    } else if (op.t === "order") {
      const list = out[op.c] as { id: string }[];
      const rank = new Map(op.ids.map((id, i) => [id, i]));
      // What the order names goes in that order; anything it doesn't know (added meanwhile) keeps its place after.
      (out as unknown as Record<Coll, unknown[]>)[op.c] = [...list].sort((a, b) => (rank.get(a.id) ?? 1e9 + list.indexOf(a)) - (rank.get(b.id) ?? 1e9 + list.indexOf(b)));
    }
  }
  return out;
}

/** The operations that turn `a` into `b`. */
export function diffContent(a: TripContent, b: TripContent): Op[] {
  const ops: Op[] = [];
  for (const f of FIELDS) if (!same(a[f], b[f])) ops.push({ t: "set", f, v: b[f] ?? null });
  for (const c of COLLS) {
    const before = new Map((a[c] as { id: string }[]).map((x) => [x.id, x]));
    const after = b[c] as ({ id: string } & Record<string, unknown>)[];
    const ids = new Set(after.map((x) => x.id));
    for (const x of after) if (!before.has(x.id) || !same(before.get(x.id), x)) ops.push({ t: "put", c, item: x });
    for (const id of before.keys()) if (!ids.has(id)) ops.push({ t: "del", c, id });
    if (ORDERED.includes(c)) {
      const kept = (a[c] as { id: string }[]).map((x) => x.id).filter((id) => ids.has(id));
      const added = after.map((x) => x.id).filter((id) => !before.has(id));
      if (!same([...kept, ...added], after.map((x) => x.id))) ops.push({ t: "order", c, ids: after.map((x) => x.id) });
    }
  }
  return ops;
}

/** A line a person reads in the trip's history ("Ana added Hotel Lisboa"). */
export function describeOps(ops: Op[], before?: TripContent): string[] {
  const NOUN: Record<Coll, string> = { stops: "a city", plans: "a plan", events: "an event", expenses: "a cost", checklist: "a list item", contacts: "a contact", travellers: "a traveller" };
  const lines: string[] = [];
  for (const op of ops) {
    if (op.t === "put") {
      const item = op.item as Record<string, unknown>;
      const name = String(item.title ?? item.name ?? item.text ?? (item.snap as Record<string, unknown> | undefined)?.title ?? "").slice(0, 60);
      const was = before ? (before[op.c] as ({ id: string } & Record<string, unknown>)[]).find((x) => x.id === op.item.id) : undefined;
      const verb = before && !was ? "added" : op.c === "checklist" && was && !was.done && item.done ? "ticked" : before ? "changed" : "updated";
      lines.push(name ? `${verb} ${name}` : `${verb} ${NOUN[op.c]}`);
    } else if (op.t === "del") lines.push(`removed ${NOUN[op.c]}`);
    else if (op.t === "set") lines.push(op.f === "name" ? `renamed the trip` : op.f === "budget" || op.f === "currency" ? "changed the budget" : op.f === "start" || op.f === "end" ? "changed the dates" : op.f === "notes" ? "edited the notes" : "changed the trip");
    else if (op.t === "order" && op.c === "stops") lines.push("changed the route's order");
  }
  return [...new Set(lines)].slice(0, 4);
}

// ---------------------------------------------------------------- checking what arrives

export class TripShareError extends Error {}

const ID = /^[A-Za-z0-9_-]{1,48}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const PLAN_KIND_LIST: PlanKind[] = ["flight", "train", "bus", "car", "stay", "meeting", "meal", "visit", "activity", "note"];
const CATS = EXPENSE_CATEGORIES.map((c) => c.id);
const LIST_IDS = LISTS.map((l) => l.id);

/** One line of text: no control characters, capped. */
export const line = (raw: unknown, max: number) =>
  String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
/** Text that keeps its line breaks. */
const text = (raw: unknown, max: number) =>
  String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .slice(0, max);
const num = (raw: unknown, min: number, max: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};
const id = (raw: unknown) => {
  if (typeof raw !== "string" || !ID.test(raw)) throw new TripShareError("Something on the trip has a broken id.");
  return raw;
};
const day = (raw: unknown) => (typeof raw === "string" && DAY_RE.test(raw) ? raw : undefined);
const time = (raw: unknown) => (typeof raw === "string" && TIME_RE.test(raw) ? raw : undefined);
const url = (raw: unknown) => (typeof raw === "string" && /^https:\/\/[^\s"'<>]{4,600}$/.test(raw) ? raw : undefined);
const iso = (raw: unknown) => (typeof raw === "string" && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : new Date().toISOString());
const currency = (raw: unknown) => (typeof raw === "string" && /^[A-Z]{3}$/.test(raw) ? raw : undefined);
/** Drops the keys left undefined, so stored items stay small and compare equal. */
const compact = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;

function cleanStop(o: Record<string, unknown>): TripStop {
  const lat = num(o.lat, -90, 90);
  const lng = num(o.lng, -180, 180);
  const name = line(o.name, 80);
  const from = day(o.from);
  const to = day(o.to);
  if (lat === undefined || lng === undefined || !name || !from || !to) throw new TripShareError("A city on the route isn't right.");
  return compact({ id: id(o.id), name, place: line(o.place, 80) || undefined, country: line(o.country, 60) || undefined, countryCode: typeof o.countryCode === "string" && /^[A-Z]{2}$/.test(o.countryCode) ? o.countryCode : undefined, lat, lng, cityId: typeof o.cityId === "string" && /^[a-z0-9-]{1,48}$/.test(o.cityId) ? o.cityId : undefined, from, to }) as TripStop;
}

function cleanPlan(o: Record<string, unknown>): TripPlan {
  const kind = PLAN_KIND_LIST.includes(o.kind as PlanKind) ? (o.kind as PlanKind) : "note";
  const title = line(o.title, 140);
  if (!title) throw new TripShareError("A plan needs a name.");
  // "day" stays even when empty (a place to see on no day yet).
  return {
    day: day(o.day) ?? "",
    ...compact({
    id: id(o.id),
    kind,
    title,
    time: time(o.time),
    endDay: day(o.endDay),
    endTime: time(o.endTime),
    from: line(o.from, 80) || undefined,
    to: line(o.to, 80) || undefined,
    place: line(o.place, 160) || undefined,
    ref: line(o.ref, 80) || undefined,
    notes: text(o.notes, 2000) || undefined,
    lat: num(o.lat, -90, 90),
    lng: num(o.lng, -180, 180),
    poi: typeof o.poi === "string" && /^[a-z_]{1,40}$/.test(o.poi) ? o.poi : undefined,
    image: url(o.image),
    createdAt: iso(o.createdAt),
    }),
  } as unknown as TripPlan;
}

const SNAP_TEXT = ["slug", "title", "start", "timeZone", "eventType", "venueName", "venueSlug", "categorySlug", "city", "cityId", "countryCode", "groupSlug", "until"];
function cleanEvent(o: Record<string, unknown>): TripEventItem {
  const raw = (o.snap ?? undefined) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return { id: id(o.id) };
  const snap: Record<string, unknown> = {};
  for (const k of SNAP_TEXT) if (raw[k] != null) snap[k] = line(raw[k], 200);
  if (raw.hoursUnknown === true) snap.hoursUnknown = true;
  const img = url(raw.imageUrl);
  if (img) snap.imageUrl = img;
  for (const [k, lo, hi] of [["posterHue", 0, 360], ["lat", -90, 90], ["lng", -180, 180]] as const) {
    const n = num(raw[k], lo, hi);
    if (n !== undefined) snap[k] = n;
  }
  return { id: id(o.id), snap };
}

function cleanExpense(o: Record<string, unknown>): Expense {
  const amount = num(o.amount, 0, 10_000_000);
  const cur = currency(o.currency);
  const title = line(o.title, 120);
  if (amount === undefined || !cur || !title) throw new TripShareError("A cost needs a name, an amount and a currency.");
  const split = Array.isArray(o.split) ? [...new Set(o.split.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, 30) : undefined;
  return compact({
    id: id(o.id),
    title,
    amount: Math.round(amount * 100) / 100,
    currency: cur,
    category: CATS.includes(o.category as ExpenseCategory) ? (o.category as ExpenseCategory) : "other",
    day: day(o.day),
    paidBy: typeof o.paidBy === "string" && ID.test(o.paidBy) ? o.paidBy : undefined,
    split: split?.length ? split : undefined,
    estimate: o.estimate === true ? true : undefined,
    planId: typeof o.planId === "string" && ID.test(o.planId) ? o.planId : undefined,
    eventId: typeof o.eventId === "string" && ID.test(o.eventId) ? o.eventId : undefined,
    createdAt: iso(o.createdAt),
  }) as unknown as Expense;
}

function cleanCheck(o: Record<string, unknown>): CheckItem {
  const t = line(o.text, 160);
  if (!t) throw new TripShareError("A list item needs some text.");
  return compact({
    id: id(o.id),
    list: LIST_IDS.includes(o.list as ListKind) ? (o.list as ListKind) : "todo",
    text: t,
    done: o.done === true ? true : undefined,
    who: typeof o.who === "string" && ID.test(o.who) ? o.who : undefined,
    due: day(o.due),
    note: line(o.note, 300) || undefined,
    createdAt: iso(o.createdAt),
  }) as unknown as CheckItem;
}

function cleanContact(o: Record<string, unknown>): Contact {
  const name = line(o.name, 80);
  if (!name) throw new TripShareError("A contact needs a name.");
  return compact({ id: id(o.id), name, role: line(o.role, 40) || undefined, phone: line(o.phone, 40) || undefined, email: line(o.email, 120) || undefined, note: line(o.note, 300) || undefined }) as unknown as Contact;
}

function cleanTraveller(o: Record<string, unknown>): Traveller {
  const name = line(o.name, 40);
  if (!name) throw new TripShareError("A traveller needs a name.");
  const emoji = typeof o.emoji === "string" && [...o.emoji].length <= 4 && /\p{Extended_Pictographic}/u.test(o.emoji) ? o.emoji : undefined;
  return compact({ id: id(o.id), name, emoji, member: typeof o.member === "string" && ID.test(o.member) ? o.member : undefined }) as unknown as Traveller;
}

const CLEAN: Record<Coll, (o: Record<string, unknown>) => { id: string }> = {
  stops: cleanStop,
  plans: cleanPlan,
  events: cleanEvent,
  expenses: cleanExpense,
  checklist: cleanCheck,
  contacts: cleanContact,
  travellers: cleanTraveller,
};
export const LIMITS: Record<Coll, number> = { stops: 40, plans: 400, events: 400, expenses: 1000, checklist: 600, contacts: 60, travellers: 30 };

function cleanField(f: Field, v: unknown): unknown {
  if (v === null || v === undefined || v === "") return undefined;
  switch (f) {
    case "name": {
      const n = line(v, 80);
      if (!n) throw new TripShareError("The trip needs a name.");
      return n;
    }
    case "start":
    case "end":
      return day(v);
    case "emoji":
      return typeof v === "string" && [...v].length <= 4 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(v) ? v : undefined;
    case "notes":
      return text(v, 8000) || undefined;
    case "interests":
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[a-z0-9-]{1,40}$/.test(x)).slice(0, 20) : undefined;
    case "currency":
      return currency(v);
    case "budget":
      return num(v, 0, 100_000_000);
  }
}

/** One change as sent by a browser, checked (throws on anything that isn't right). */
export function cleanOp(raw: unknown): Op {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.t === "set" && FIELDS.includes(o.f as Field)) return { t: "set", f: o.f as Field, v: cleanField(o.f as Field, o.v) ?? null };
  if ((o.t === "put" || o.t === "del" || o.t === "order") && COLLS.includes(o.c as Coll)) {
    const c = o.c as Coll;
    if (o.t === "put") return { t: "put", c, item: CLEAN[c]((o.item ?? {}) as Record<string, unknown>) as { id: string } & Record<string, unknown> };
    if (o.t === "del") return { t: "del", c, id: id(o.id) };
    if (Array.isArray(o.ids)) return { t: "order", c, ids: o.ids.slice(0, LIMITS[c]).map(id) };
  }
  throw new TripShareError("That change isn't one a trip can take.");
}

/** A whole trip as sent by a browser (to start planning it together), checked. */
export function cleanContent(raw: unknown): TripContent {
  const o = (raw ?? {}) as Record<string, unknown>;
  const base: TripContent = { name: "Trip", stops: [], plans: [], events: [], expenses: [], checklist: [], contacts: [], travellers: [] };
  const ops: Op[] = FIELDS.map((f) => ({ t: "set" as const, f, v: cleanField(f, o[f]) ?? null }));
  let c = applyOps(base, ops);
  for (const coll of COLLS) {
    const list = Array.isArray(o[coll]) ? (o[coll] as unknown[]) : [];
    if (list.length > LIMITS[coll]) throw new TripShareError(`A trip can hold up to ${LIMITS[coll]} ${coll}.`);
    const seen = new Set<string>();
    const items = list.map((x) => CLEAN[coll]((x ?? {}) as Record<string, unknown>)).filter((x) => !seen.has(x.id) && seen.add(x.id));
    c = { ...c, [coll]: items };
  }
  return c;
}

/** Applies changes and checks the trip stays within its limits. */
export function applyChecked(c: TripContent, ops: Op[]): TripContent {
  const next = applyOps(c, ops);
  for (const coll of COLLS) if ((next[coll] as unknown[]).length > LIMITS[coll]) throw new TripShareError(`A trip can hold up to ${LIMITS[coll]} ${coll}.`);
  return next;
}

// ---------------------------------------------------------------- money

export interface MoneySummary {
  currency: string;
  /** Every cost, in the trip's currency. */
  total: number;
  booked: number;
  estimated: number;
  byCategory: Record<ExpenseCategory, number>;
  /** Costs in a currency the site can't convert (kept apart, never guessed). */
  unconverted: Expense[];
  /** Some amounts were converted (approximate rates). */
  converted: boolean;
}

export function moneySummary(c: Pick<TripContent, "expenses" | "currency">, fallback = "EUR"): MoneySummary {
  const cur = c.currency ?? fallback;
  const byCategory = Object.fromEntries(EXPENSE_CATEGORIES.map((x) => [x.id, 0])) as Record<ExpenseCategory, number>;
  let total = 0;
  let booked = 0;
  let converted = false;
  const unconverted: Expense[] = [];
  for (const e of c.expenses) {
    const v = convert(e.amount, e.currency, cur);
    if (v === undefined) {
      unconverted.push(e);
      continue;
    }
    if (e.currency !== cur) converted = true;
    total += v;
    if (!e.estimate) booked += v;
    byCategory[e.category] += v;
  }
  return { currency: cur, total, booked, estimated: total - booked, byCategory, unconverted, converted };
}

/** What each traveller paid and what their share comes to, in the trip's currency. */
export function perTraveller(c: Pick<TripContent, "expenses" | "travellers" | "currency">, fallback = "EUR"): Record<string, { paid: number; share: number }> {
  const cur = c.currency ?? fallback;
  const out: Record<string, { paid: number; share: number }> = Object.fromEntries(c.travellers.map((t) => [t.id, { paid: 0, share: 0 }]));
  const everyone = c.travellers.map((t) => t.id);
  for (const e of c.expenses) {
    const v = convert(e.amount, e.currency, cur);
    if (v === undefined || e.estimate) continue;
    if (e.paidBy && out[e.paidBy]) out[e.paidBy].paid += v;
    const who = (e.split?.length ? e.split : everyone).filter((id) => out[id]);
    if (!who.length) continue;
    for (const id of who) out[id].share += v / who.length;
  }
  return out;
}

/** The fewest payments that leave everyone even ("Ana pays Rui €40"). */
export function settleUp(per: Record<string, { paid: number; share: number }>): { from: string; to: string; amount: number }[] {
  const cents = Object.entries(per).map(([id, x]) => ({ id, bal: Math.round((x.paid - x.share) * 100) }));
  const owe = cents.filter((x) => x.bal < 0).sort((a, b) => a.bal - b.bal);
  const get = cents.filter((x) => x.bal > 0).sort((a, b) => b.bal - a.bal);
  const out: { from: string; to: string; amount: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < owe.length && j < get.length) {
    const n = Math.min(-owe[i].bal, get[j].bal);
    if (n > 0) out.push({ from: owe[i].id, to: get[j].id, amount: n / 100 });
    owe[i].bal += n;
    get[j].bal -= n;
    if (owe[i].bal === 0) i++;
    if (get[j].bal === 0) j++;
  }
  return out;
}

// ---------------------------------------------------------------- lists

/**
 * Ideas for each list, from what the trip already holds (a flight means a check-in, a car a
 * driving licence, several countries their entry rules). Nothing here is a rule or a figure:
 * only reminders of what people usually need, to tick or ignore.
 */
export function listIdeas(c: Pick<TripContent, "stops" | "plans" | "events" | "checklist" | "start" | "end">, list: ListKind): string[] {
  const kinds = new Set(c.plans.map((p) => p.kind));
  const countries = [...new Set(c.stops.map((s) => s.country).filter(Boolean))] as string[];
  const nights = c.start && c.end ? Math.max(1, Math.round((Date.parse(c.end) - Date.parse(c.start)) / 86_400_000)) : 0;
  const ideas: string[] =
    list === "todo"
      ? [
          "Check passports or ID cards are valid for the whole trip",
          countries.length ? `Check entry rules for ${countries.slice(0, 3).join(", ")}${countries.length > 3 ? "…" : ""}` : "Check the entry rules where you're going",
          "Buy travel insurance",
          "Tell the bank you're travelling (and check card fees abroad)",
          "Check your phone's roaming or get a local SIM / eSIM",
          ...(kinds.has("flight") ? ["Check in online for the flight", "Check the baggage allowance"] : []),
          ...(kinds.has("car") ? ["Check what the car hire needs (licence, deposit card)"] : []),
          ...(c.events.length ? ["Download the event tickets to your phone"] : []),
          "Download offline maps",
          "Share the plan with someone at home",
        ]
      : list === "packing"
        ? [
            "Passport or ID card",
            "Phone and charger",
            "Plug adapter (check the sockets where you're going)",
            "Power bank",
            "Medicines you take",
            "Toiletries",
            nights ? `Clothes for ${nights} ${nights === 1 ? "day" : "days"}` : "Clothes",
            "Comfortable shoes",
            "A light jacket or rain jacket",
            "Sunglasses",
            "Headphones",
            "Reusable water bottle",
            "Bank card and a little cash",
          ]
        : [
            "Passport or ID card",
            "Visa or travel authorisation (if needed)",
            "Travel insurance policy and phone number",
            "European Health Insurance Card (for EU travellers in Europe)",
            ...(kinds.has("car") ? ["Driving licence"] : []),
            ...(kinds.has("flight") ? ["Boarding passes"] : []),
            ...(kinds.has("stay") ? ["Hotel bookings"] : []),
            ...(c.events.length ? ["Event tickets"] : []),
            "A copy of everything, kept apart from the originals",
          ];
  const have = new Set(c.checklist.filter((x) => x.list === list).map((x) => x.text.toLowerCase()));
  return ideas.filter((x) => !have.has(x.toLowerCase()));
}

/** "4 of 9 done". */
export function listProgress(items: CheckItem[], list?: ListKind) {
  const mine = list ? items.filter((x) => x.list === list) : items;
  return { done: mine.filter((x) => x.done).length, all: mine.length };
}

export const newId = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
