import "server-only";
import { randomBytes } from "node:crypto";
import tzlookup from "@photostructure/tz-lookup";
import { z } from "zod";
import { cmd, pipe, type Cmd } from "./community/kv";
import { CommunityError, limit, requireProfile } from "./community/service";
import { getCategory, groupOf } from "./categories";
import { isCurrency } from "./currency";
import { COUNTRIES, getCountry, slugify } from "./destinations";
import { nearestCityId } from "./providers/common";
import { isValidTimeZone, zonedToUtc } from "./time";
import type { OmniEvent, Participant, ParticipantKind, ParticipantRole, TicketOffer, Venue } from "./types";
import type { ProviderBatch } from "./providers/types";
import { ACCESSIBILITY_OPTIONS, AGE_OPTIONS, LIMITS, POSTER_STYLE_IDS, cleanUrl, listingTextProblem, type UserEventInput } from "./user-events-shared";

/**
 * Events listed by members. Each is stored whole in the community storage; the catalogue reads
 * them back as one more source ("members"), so they appear on the globe, in lists and search
 * like any other event. Only the member who listed an event can change or remove it; members
 * can report one, and three reports take it off the site until it is looked at.
 */

export const PROVIDER_ID = "members";

export interface UserEvent extends UserEventInput {
  id: string;
  owner: string;
  ownerName: string;
  ownerUsername?: string;
  timeZone: string;
  /** UTC start of the first performance, its end, and any repeat performances. */
  start: string;
  end?: string;
  schedule?: string[];
  createdAt: string;
  updatedAt: string;
  cancelled?: boolean;
  hidden?: boolean;
}

const K = {
  event: (id: string) => `ue:e:${id}`,
  all: "ue:all",
  own: (owner: string) => `ue:own:${owner}`,
  ver: "ue:ver",
  reports: (id: string) => `ue:rep:${id}`,
};

const DAY = 864e5;
const ymd = /^\d{4}-\d{2}-\d{2}$/;
const hm = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => s || undefined);
const list = (max: number, itemMax: number) =>
  z
    .array(z.string().trim().min(1).max(itemMax))
    .max(max)
    .default([])
    .transform((a) => [...new Set(a.map((x) => x.replace(/\s+/g, " ")))]);
const url = z
  .unknown()
  .optional()
  .transform((v, ctx) => {
    if (v == null || v === "") return undefined;
    const u = cleanUrl(v);
    if (!u) ctx.addIssue({ code: "custom", message: "That doesn't look like a web address (https://…)." });
    return u;
  });
const money = z.coerce.number().min(0).max(LIMITS.price).optional();

const schema = z.object({
  title: text(LIMITS.title[0], LIMITS.title[1]),
  category: z.string().refine((s) => !!getCategory(s)?.active, "Choose a category."),
  tagline: optText(LIMITS.tagline),
  description: text(LIMITS.description[0], LIMITS.description[1]),
  genres: list(LIMITS.genres, 30),
  performers: list(LIMITS.performers, 80),
  date: z.string().regex(ymd, "Choose a date."),
  time: z.string().regex(hm, "Choose a start time."),
  endDate: z.string().regex(ymd).optional().or(z.literal("").transform(() => undefined)),
  endTime: z.string().regex(hm).optional().or(z.literal("").transform(() => undefined)),
  repeat: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }),
      z.object({ kind: z.literal("weekly"), weeks: z.coerce.number().int().min(LIMITS.weeks[0]).max(LIMITS.weeks[1]) }),
      z.object({ kind: z.literal("dates"), dates: z.array(z.string().regex(ymd)).min(1).max(LIMITS.extraDates) }),
    ])
    .default({ kind: "none" }),
  venue: z.object({
    name: text(LIMITS.venueName[0], LIMITS.venueName[1]),
    address: optText(LIMITS.address),
    city: text(1, 80),
    country: text(2, 80),
    countryCode: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .optional()
      .transform((s) => s?.toUpperCase()),
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
  }),
  access: z.enum(["free", "ticketed", "registration"]),
  priceMin: money,
  tiers: z
    .array(z.object({ name: text(1, LIMITS.tierName), price: z.coerce.number().min(0).max(LIMITS.price) }))
    .max(LIMITS.tiers)
    .optional()
    .transform((a) => (a?.length ? a : undefined)),
  priceMax: money,
  currency: z
    .string()
    .optional()
    .refine((c) => !c || isCurrency(c), "Choose a currency."),
  ticketUrl: url,
  soldOut: z.boolean().optional().default(false),
  capacity: z.coerce.number().int().min(1).max(1000000).optional(),
  ageMin: z.coerce
    .number()
    .int()
    .refine((n) => AGE_OPTIONS.some((a) => a.min === n), "Choose an age policy.")
    .default(0),
  familyFriendly: z.boolean().default(false),
  accessibility: z.array(z.enum(ACCESSIBILITY_OPTIONS)).max(ACCESSIBILITY_OPTIONS.length).default([]),
  languages: list(5, 30),
  imageUrl: z
    .unknown()
    .optional()
    .transform((v, ctx) => {
      if (v == null || v === "") return undefined;
      const u = cleanUrl(v, { https: true });
      if (!u) ctx.addIssue({ code: "custom", message: "The picture needs a secure web address (https://…)." });
      return u;
    }),
  hue: z.coerce.number().int().min(0).max(359).default(210),
  posterStyle: z.enum(POSTER_STYLE_IDS).optional(),
  programme: z
    .array(z.object({ time: z.string().regex(hm, "Each programme item needs a time."), title: text(2, LIMITS.programmeTitle) }))
    .max(LIMITS.programme)
    .optional()
    .transform((a) => (a?.length ? [...a].sort((x, y) => x.time.localeCompare(y.time)) : undefined)),
  organiser: z.object({ name: text(LIMITS.organiser[0], LIMITS.organiser[1]), url }),
  website: url,
  agree: z.boolean().refine((v) => v === true, "Confirm that you may list this event."),
});

/** Plain words for a field that fails a basic check. */
const FIELD_HELP: Record<string, string> = {
  title: `Give your event a name (${LIMITS.title[0]} to ${LIMITS.title[1]} characters).`,
  tagline: `Keep the one-liner under ${LIMITS.tagline} characters.`,
  description: `Describe your event in ${LIMITS.description[0]} to ${LIMITS.description[1]} characters.`,
  genres: `Up to ${LIMITS.genres} genres or styles, each short.`,
  performers: `Up to ${LIMITS.performers} names in the line-up.`,
  endDate: "Check the end date.",
  endTime: "Check the end time.",
  repeat: `Repeats: weekly for ${LIMITS.weeks[0]} to ${LIMITS.weeks[1]} weeks, or up to ${LIMITS.extraDates} extra dates.`,
  "venue.name": "Give the place a name (the venue, park, bar…).",
  "venue.city": "Choose where it is on the map: the city is missing.",
  "venue.country": "Choose where it is on the map: the country is missing.",
  "venue.lat": "Choose where it is on the map.",
  "venue.lng": "Choose where it is on the map.",
  venue: "Choose where it is on the map.",
  access: "Say whether it's free, paid or needs signing up.",
  priceMin: "Check the ticket price.",
  priceMax: "Check the highest ticket price.",
  capacity: "Check the capacity (a whole number).",
  languages: "Up to 5 languages.",
  "organiser.name": `Who organises it? (${LIMITS.organiser[0]} to ${LIMITS.organiser[1]} characters).`,
  hue: "Choose a colour.",
};

const parts = (d: string) => d.split("-").map(Number) as [number, number, number];
const clock = (t: string) => t.split(":").map(Number) as [number, number];
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The input checked and completed: times in UTC at the venue's zone, a country code, sane prices. */
export function validate(raw: unknown, now = Date.now()): Omit<UserEvent, "id" | "owner" | "ownerName" | "ownerUsername" | "createdAt" | "updatedAt"> {
  const p = schema.safeParse(raw);
  if (!p.success) {
    const issue = p.error.issues[0];
    const field = issue.path.join(".");
    const custom = issue.code === "custom" || (issue.message && !/^(Invalid|Expected|Too|String must|Number must|Array must)/i.test(issue.message));
    throw new CommunityError(custom ? issue.message : (FIELD_HELP[field] ?? FIELD_HELP[String(issue.path[0])] ?? `Check "${field}".`), 400);
  }
  const v = p.data;

  for (const t of [v.title, v.tagline ?? "", v.description, ...v.performers, ...(v.tiers ?? []).map((x) => x.name), ...(v.programme ?? []).map((x) => x.title)]) {
    const why = listingTextProblem(t);
    if (why) throw new CommunityError(why, 400);
  }

  let timeZone = "UTC";
  try {
    timeZone = tzlookup(v.venue.lat, v.venue.lng);
  } catch {
    // at sea, or outside every zone: UTC
  }
  if (!isValidTimeZone(timeZone)) timeZone = "UTC";

  const at = (d: string, t: string) => {
    const [y, m, dd] = parts(d);
    const [h, mi] = clock(t);
    return zonedToUtc(y, m, dd, h, mi, timeZone);
  };
  const start = at(v.date, v.time);
  if (start < now - 12 * 3600000) throw new CommunityError("The start is in the past. Choose a date from today on.", 400);
  if (start > now + 2 * 365 * DAY) throw new CommunityError("Events can be listed up to two years ahead.", 400);

  // The end: on the end date if there is one, otherwise the same day (or just past midnight).
  let end: number | undefined;
  if (v.endDate || v.endTime) {
    const endDate = v.endDate ?? v.date;
    end = at(endDate, v.endTime ?? (v.endDate ? "23:59" : v.time));
    if (!v.endDate && end <= start) end = at(addDays(v.date, 1), v.endTime!);
    if (end <= start) throw new CommunityError("The end must be after the start.", 400);
    if (end - start > 366 * DAY) throw new CommunityError("An event can run for a year at most.", 400);
  }
  const length = end ? end - start : undefined;

  // Repeat performances, at the same local time on each day.
  let schedule: string[] | undefined;
  if (v.repeat.kind === "weekly") schedule = Array.from({ length: v.repeat.weeks - 1 }, (_, i) => new Date(at(addDays(v.date, 7 * (i + 1)), v.time)).toISOString());
  if (v.repeat.kind === "dates") {
    const extra = [...new Set(v.repeat.dates)].filter((d) => d !== v.date).sort();
    if (extra.some((d) => d < v.date)) throw new CommunityError("Extra dates must come after the first date.", 400);
    schedule = extra.map((d) => new Date(at(d, v.time)).toISOString());
  }
  if (schedule && length && length > DAY) throw new CommunityError("Repeats are for one-day events. For a festival over several days, set an end date instead.", 400);
  if (schedule?.length === 0) schedule = undefined;

  // Prices make sense, and paid tickets say what they cost (ticket types give the range).
  if (v.access === "ticketed" && v.tiers?.length) {
    const prices = v.tiers.map((t) => t.price);
    v.priceMin = Math.min(...prices);
    v.priceMax = Math.max(...prices);
  }
  if (v.access === "ticketed") {
    if (v.priceMin == null) throw new CommunityError("Add a ticket price (from).", 400);
    if (!v.currency) throw new CommunityError("Choose the price's currency.", 400);
    if (v.priceMax != null && v.priceMax < v.priceMin) throw new CommunityError("The highest price can't be lower than the lowest.", 400);
  }
  const priced = v.access === "ticketed";

  const countryCode = v.venue.countryCode ?? COUNTRIES.find((c) => c.name.toLowerCase() === v.venue.country.toLowerCase() || c.aliases?.some((a) => a.toLowerCase() === v.venue.country.toLowerCase()))?.countryCode ?? undefined;

  return {
    ...v,
    venue: { ...v.venue, countryCode },
    priceMin: priced ? v.priceMin : undefined,
    priceMax: priced && v.priceMax != null && v.priceMax > v.priceMin! ? v.priceMax : undefined,
    tiers: priced ? v.tiers : undefined,
    currency: priced ? v.currency : undefined,
    soldOut: priced || v.access === "registration" ? v.soldOut : false,
    familyFriendly: v.familyFriendly || v.ageMin === 0 ? v.familyFriendly : false,
    timeZone,
    start: new Date(start).toISOString(),
    end: end ? new Date(end).toISOString() : undefined,
    schedule,
    repeat: v.repeat,
    agree: true,
  };
}

// ---- Storage -------------------------------------------------------------------------------

const newId = () => `ue${randomBytes(6).toString("base64url").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8).padEnd(8, "x")}`;
export const slugOf = (e: Pick<UserEvent, "id" | "title" | "venue">) => `${slugify(e.title).slice(0, 60) || "event"}-${slugify(e.venue.city).slice(0, 24) || "here"}-${e.id}`;
const read = (raw: unknown): UserEvent | undefined => {
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw) as UserEvent;
  } catch {
    return undefined;
  }
};

async function load(id: string): Promise<UserEvent | undefined> {
  if (!/^ue[a-z0-9]{8}$/.test(id)) return undefined;
  return read(await cmd(["GET", K.event(id)]));
}

/** A rate limit with its own message. */
async function cap(key: string, max: number, windowSec: number, message: string) {
  try {
    await limit(key, max, windowSec);
  } catch (err) {
    if (err instanceof CommunityError && err.status === 429) throw new CommunityError(message, 429);
    throw err;
  }
}

async function owned(secret: string, id: unknown) {
  const me = await requireProfile(secret);
  const e = await load(String(id ?? ""));
  if (!e) throw new CommunityError("That event doesn't exist any more.", 404);
  if (e.owner !== me.id) throw new CommunityError("Only the member who listed this event can change it.", 403);
  return { me, e };
}

export async function createUserEvent(secret: string, raw: unknown, ip: string): Promise<{ id: string; slug: string }> {
  const me = await requireProfile(secret);
  const v = validate(raw);
  // A handful a day per member (and per network), so the map isn't flooded.
  await cap(`ue-new:${me.id}`, 5, 86400, "You've listed a lot of events today. Try again tomorrow.");
  await cap(`ue-new-ip:${ip}`, 12, 86400, "Many events were listed from this network today. Try again tomorrow.");
  const now = new Date().toISOString();
  const e: UserEvent = { ...v, id: newId(), owner: me.id, ownerName: me.name, ownerUsername: me.username, createdAt: now, updatedAt: now };
  await pipe([["SET", K.event(e.id), JSON.stringify(e)], ["SADD", K.all, e.id], ["SADD", K.own(me.id), e.id], ["INCR", K.ver]]);
  return { id: e.id, slug: slugOf(e) };
}

export async function updateUserEvent(secret: string, id: unknown, raw: unknown): Promise<{ id: string; slug: string }> {
  const { me, e } = await owned(secret, id);
  await cap(`ue-edit:${me.id}`, 60, 86400, "Too many changes today. Try again tomorrow.");
  const v = validate(raw, Math.min(Date.now(), Date.parse(e.start)));
  const next: UserEvent = { ...e, ...v, ownerName: me.name, ownerUsername: me.username, updatedAt: new Date().toISOString() };
  await pipe([["SET", K.event(e.id), JSON.stringify(next)], ["INCR", K.ver]]);
  return { id: next.id, slug: slugOf(next) };
}

export async function setCancelled(secret: string, id: unknown, cancelled: boolean) {
  const { e } = await owned(secret, id);
  await pipe([["SET", K.event(e.id), JSON.stringify({ ...e, cancelled, updatedAt: new Date().toISOString() })], ["INCR", K.ver]]);
  return { id: e.id, slug: slugOf(e), cancelled };
}

export async function deleteUserEvent(secret: string, id: unknown) {
  const { me, e } = await owned(secret, id);
  await pipe([["DEL", K.event(e.id)], ["DEL", K.reports(e.id)], ["SREM", K.all, e.id], ["SREM", K.own(me.id), e.id], ["INCR", K.ver]]);
  return { deleted: true };
}

/** The owner's copy, to edit in the questionnaire. */
export async function editableUserEvent(secret: string, id: unknown): Promise<UserEventInput & { id: string; slug: string; cancelled?: boolean; hidden?: boolean }> {
  const { e } = await owned(secret, id);
  // Only what the questionnaire asks for (and the event's own state), not the stored extras.
  const input: UserEventInput = {
    title: e.title, category: e.category, tagline: e.tagline, description: e.description, genres: e.genres, performers: e.performers,
    date: e.date, time: e.time, endDate: e.endDate, endTime: e.endTime, repeat: e.repeat, venue: e.venue, access: e.access,
    priceMin: e.priceMin, priceMax: e.priceMax, currency: e.currency, ticketUrl: e.ticketUrl, soldOut: e.soldOut, capacity: e.capacity,
    ageMin: e.ageMin, familyFriendly: e.familyFriendly, accessibility: e.accessibility, languages: e.languages, imageUrl: e.imageUrl,
    hue: e.hue, organiser: e.organiser, website: e.website, agree: e.agree, tiers: e.tiers, programme: e.programme, posterStyle: e.posterStyle,
  };
  return { ...input, id: e.id, slug: slugOf(e), cancelled: e.cancelled, hidden: e.hidden };
}

export interface MyEventRow {
  id: string;
  slug: string;
  title: string;
  start: string;
  timeZone: string;
  city: string;
  category: string;
  cancelled?: boolean;
  hidden?: boolean;
  imageUrl?: string;
  hue: number;
}

export async function myUserEvents(secret: string): Promise<MyEventRow[]> {
  const me = await requireProfile(secret);
  const ids = ((await cmd<string[]>(["SMEMBERS", K.own(me.id)])) ?? []) as string[];
  const events = await loadMany(ids);
  return events
    .map((e) => ({ id: e.id, slug: slugOf(e), title: e.title, start: e.start, timeZone: e.timeZone, city: e.venue.city, category: e.category, cancelled: e.cancelled, hidden: e.hidden, imageUrl: e.imageUrl ?? (e.posterStyle ? posterUrl(e) : undefined), hue: e.hue }))
    .sort((a, b) => b.start.localeCompare(a.start));
}

/** Three members reporting an event takes it off the site. */
export async function reportUserEvent(secret: string, id: unknown) {
  const me = await requireProfile(secret);
  const e = await load(String(id ?? ""));
  if (!e) throw new CommunityError("That event doesn't exist any more.", 404);
  if (e.owner === me.id) throw new CommunityError("You can edit or remove your own event instead.", 400);
  await cap(`ue-rep:${me.id}`, 20, 86400, "Too many reports today.");
  const [, n] = await pipe([["SADD", K.reports(e.id), me.id], ["SCARD", K.reports(e.id)]]);
  if (Number(n) >= 3 && !e.hidden) await pipe([["SET", K.event(e.id), JSON.stringify({ ...e, hidden: true })], ["INCR", K.ver]]);
  return { reported: true };
}

async function loadMany(ids: string[]): Promise<UserEvent[]> {
  const out: UserEvent[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (!chunk.length) break;
    const vals = (await cmd<unknown[]>(["MGET", ...chunk.map(K.event)])) ?? [];
    for (const v of vals) {
      const e = read(v);
      if (e) out.push(e);
    }
  }
  return out;
}

// ---- The catalogue source ------------------------------------------------------------------

let cache: { ver: string; events: UserEvent[] } | undefined;

/** Every listed event, read again only when something changed (one small check otherwise). */
export async function loadAllUserEvents(): Promise<UserEvent[]> {
  const ver = String((await cmd(["GET", K.ver])) ?? "0");
  if (cache?.ver === ver) return cache.events;
  const ids = ((await cmd<string[]>(["SMEMBERS", K.all])) ?? []) as string[];
  const events = await loadMany(ids);
  cache = { ver, events };
  return events;
}

const PEOPLE: Record<string, [ParticipantKind, ParticipantRole, ParticipantRole]> = {
  music: ["artist", "headliner", "artist"],
  nightlife: ["artist", "dj", "dj"],
  sports: ["team", "team", "team"],
  conferences: ["speaker", "speaker", "speaker"],
  technology: ["speaker", "speaker", "speaker"],
  education: ["speaker", "speaker", "speaker"],
  theatre: ["performer", "cast", "cast"],
  comedy: ["performer", "performer", "performer"],
};

/** Listed events as the catalogue's records: upcoming, not hidden. */
export function toBatch(list: UserEvent[], now = Date.now()): ProviderBatch {
  const batch: ProviderBatch = { events: [], venues: [], participants: [], offers: [] };
  for (const u of list) {
    const last = Date.parse(u.schedule?.at(-1) ?? u.end ?? u.start) + (u.end ? 0 : 3 * 3600000);
    if (u.hidden || !(last > now - DAY)) continue;
    const id = `${PROVIDER_ID}-${u.id}`;
    const group = groupOf(u.category);
    const synced = u.updatedAt;
    const provenance = { provider: PROVIDER_ID, externalId: u.id, sourceUrl: u.website, lastSyncedAt: synced, isDemo: false };
    const venueId = `${PROVIDER_ID}-v-${u.id}`;
    const country = u.venue.countryCode ? getCountry(u.venue.countryCode) : undefined;
    const venue: Venue = {
      id: venueId,
      slug: `${slugify(u.venue.name).slice(0, 50) || "venue"}-${slugify(u.venue.city).slice(0, 24)}-${u.id}`,
      name: u.venue.name,
      address: u.venue.address,
      city: u.venue.city,
      cityId: nearestCityId(u.venue.lat, u.venue.lng),
      country: country?.name ?? u.venue.country,
      countryCode: u.venue.countryCode ?? "",
      lat: u.venue.lat,
      lng: u.venue.lng,
      timeZone: u.timeZone,
      accessibility: u.accessibility.length ? u.accessibility : undefined,
      provenance,
    };
    const [kind, firstRole, role] = PEOPLE[group] ?? ["performer", "performer", "performer"];
    const people = u.performers.map((name, i): { p: Participant; role: ParticipantRole } => ({
      p: { id: `${PROVIDER_ID}-p-${slugify(name)}`, slug: `${slugify(name)}-m`, name, kind, provenance },
      role: i === 0 ? firstRole : role,
    }));
    const length = u.end ? Date.parse(u.end) - Date.parse(u.start) : undefined;
    const e: OmniEvent = {
      id,
      canonicalId: id,
      slug: slugOf(u),
      title: u.title,
      tagline: u.tagline,
      description: u.description,
      categorySlug: u.category,
      groupSlug: group,
      eventType: length && length > DAY ? "multi_day" : u.schedule?.length ? "recurring" : "single",
      venueId,
      start: u.start,
      end: u.end,
      timeZone: u.timeZone,
      durationMinutes: length && length <= DAY ? Math.round(length / 60000) : undefined,
      status: u.cancelled ? "cancelled" : u.soldOut ? "sold_out" : u.access === "free" ? "free_entry" : u.access === "registration" ? "registration_required" : "on_sale",
      ticketAccess: u.access,
      isFree: u.access !== "ticketed",
      registrationRequired: u.access === "registration",
      online: false,
      familyFriendly: u.familyFriendly,
      ageRestriction: { minAge: u.ageMin || undefined, note: u.ageMin ? `For ages ${u.ageMin} and over.` : "All ages welcome." },
      accessibility: u.accessibility.length ? u.accessibility : undefined,
      officialUrl: u.website ?? u.ticketUrl ?? u.organiser.url,
      // No picture: the Studio's poster, drawn on demand (the version changes with every edit).
      imageUrl: u.imageUrl ?? (u.posterStyle ? posterUrl(u) : undefined),
      programme: u.programme,
      posterHue: u.hue,
      participants: people.map(({ p, role }, order) => ({ participantId: p.id, role, order })),
      schedule: u.schedule,
      tags: [...u.genres, ...u.languages.map((l) => `in ${l}`)],
      announcedAt: u.createdAt,
      listedBy: { id: u.owner, name: u.ownerName, username: u.ownerUsername, organiser: u.organiser.name, organiserUrl: u.organiser.url },
      provenance,
    };
    batch.events.push(e);
    batch.venues.push(venue);
    for (const { p } of people) if (!batch.participants.some((x) => x.id === p.id)) batch.participants.push(p);
    const currency = u.currency ?? country?.currency ?? "EUR";
    if (u.access === "ticketed" && u.tiers?.length) {
      // One offer per ticket type, so the event page lists them all.
      u.tiers.forEach((t, i) =>
        batch.offers.push({
          id: `${PROVIDER_ID}-o-${u.id}-${i}`,
          eventId: id,
          provider: u.organiser.name,
          providerType: "organizer",
          ticketCategory: "standard",
          label: t.name,
          basePrice: t.price,
          currency,
          availability: u.soldOut ? "sold_out" : "unknown",
          purchaseUrl: u.ticketUrl,
          priceObservedAt: synced,
          isDemo: false,
        }),
      );
    } else if (u.access !== "free" && (u.access === "ticketed" || u.ticketUrl)) {
      const offer: TicketOffer = {
        id: `${PROVIDER_ID}-o-${u.id}`,
        eventId: id,
        provider: u.organiser.name,
        providerType: "organizer",
        ticketCategory: "standard",
        label: u.access === "registration" ? "Free registration" : undefined,
        basePrice: u.priceMin,
        maxPrice: u.priceMax,
        currency,
        availability: u.soldOut ? "sold_out" : "unknown",
        purchaseUrl: u.ticketUrl,
        priceObservedAt: synced,
        isDemo: false,
      };
      batch.offers.push(offer);
    }
  }
  return batch;
}

/** Where a listing's Studio poster is drawn; the version makes an edit show at once. */
export const posterUrl = (u: Pick<UserEvent, "id" | "posterStyle" | "updatedAt">) => `/api/poster/${u.id}?s=${u.posterStyle ?? "bold"}&v=${Date.parse(u.updatedAt).toString(36)}`;

/** Test helper. */
export const __testing = { resetCache: () => (cache = undefined), keys: K };
export type { Cmd };
