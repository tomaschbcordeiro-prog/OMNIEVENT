import { getCategory, groupOf } from "@/lib/categories";
import { getCountry } from "@/lib/destinations";
import { cleanUrl, LIMITS, listingTextProblem, type AccessKind, type UserEventInput } from "@/lib/user-events-shared";
import { posterWhen, type PosterData, type PosterStyle } from "@/lib/studio/poster";
import type { StudioTemplate } from "@/lib/studio/templates";
import type { Extracted } from "@/lib/studio/magic";

/** The questionnaire's answers as typed (numbers stay text until they're sent). */
export interface Draft {
  title: string;
  group: string;
  category: string;
  tagline: string;
  description: string;
  genres: string[];
  performers: string[];
  date: string;
  time: string;
  endTime: string;
  multiDay: boolean;
  endDate: string;
  repeat: "none" | "weekly" | "dates";
  weeks: number;
  dates: string[];
  venue: { name: string; address: string; city: string; country: string; countryCode: string; lat: number | null; lng: number | null };
  /** What to search on the map first (from a pasted announcement). */
  placeQuery: string;
  access: AccessKind | "";
  tiers: { name: string; price: string }[];
  currency: string;
  ticketUrl: string;
  soldOut: boolean;
  capacity: string;
  ageMin: number;
  familyFriendly: boolean;
  accessibility: string[];
  languages: string[];
  programme: { time: string; title: string }[];
  /** "photo" uses the picture's address; the others are Studio posters. */
  look: PosterStyle | "photo";
  imageUrl: string;
  hue: number;
  organiserName: string;
  organiserUrl: string;
  website: string;
  agree: boolean;
}

export const emptyDraft = (): Draft => ({
  title: "",
  group: "",
  category: "",
  tagline: "",
  description: "",
  genres: [],
  performers: [],
  date: "",
  time: "",
  endTime: "",
  multiDay: false,
  endDate: "",
  repeat: "none",
  weeks: 4,
  dates: [],
  venue: { name: "", address: "", city: "", country: "", countryCode: "", lat: null, lng: null },
  placeQuery: "",
  access: "",
  tiers: [{ name: "Standard", price: "" }],
  currency: "",
  ticketUrl: "",
  soldOut: false,
  capacity: "",
  ageMin: 0,
  familyFriendly: false,
  accessibility: [],
  languages: [],
  programme: [],
  look: "bold",
  imageUrl: "",
  hue: 265,
  organiserName: "",
  organiserUrl: "",
  website: "",
  agree: false,
});

export const STEPS = [
  { id: "basics", label: "Basics", title: "What's your event?", lede: "A clear name and the right category help the right people find it." },
  { id: "place", label: "Place", title: "Where is it happening?", lede: "Pin the exact spot: it puts your event on the globe and on the city's page." },
  { id: "when", label: "Date & time", title: "When is it?", lede: "Times are local to the venue, so visitors from anywhere see them right." },
  { id: "tickets", label: "Tickets", title: "How do people get in?", lede: "Free, ticket types with their prices, or sign-up first." },
  { id: "details", label: "Details", title: "Tell people more", lede: "What to expect, who's on, the running order, and who it's for." },
  { id: "look", label: "Poster", title: "Design your poster", lede: "No picture? The Studio draws one from your details. It's used on cards, your page and when people share it." },
  { id: "publish", label: "Publish", title: "Check and publish", lede: "One last look before it goes live for everyone." },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

const pad = (n: number) => String(n).padStart(2, "0");
export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const num = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(",", ".")));

/** What still needs fixing on a step, field by field, in plain words. */
export function problems(step: StepId, d: Draft): Record<string, string> {
  const p: Record<string, string> = {};
  const text = (field: string, v: string) => {
    const why = v && listingTextProblem(v);
    if (why) p[field] = why;
  };
  if (step === "basics") {
    const t = d.title.trim();
    if (t.length < LIMITS.title[0]) p.title = "Give your event a name.";
    else if (t.length > LIMITS.title[1]) p.title = `Keep the name under ${LIMITS.title[1]} characters.`;
    else text("title", t);
    if (!d.group) p.category = "Choose what kind of event it is.";
    if (d.tagline.length > LIMITS.tagline) p.tagline = `Keep it under ${LIMITS.tagline} characters.`;
    else text("tagline", d.tagline);
  }
  if (step === "place") {
    if (d.venue.name.trim().length < LIMITS.venueName[0]) p.venueName = "Name the place (a venue, a park, a bar…).";
    if (d.venue.lat == null || d.venue.lng == null) p.pin = "Search the address or tap the map to put a pin where it happens.";
    else {
      if (!d.venue.city.trim()) p.city = "Add the city or town.";
      if (!d.venue.country.trim()) p.country = "Add the country.";
    }
  }
  if (step === "when") {
    if (!d.date) p.date = "Choose the date.";
    else if (d.date < todayLocal()) p.date = "That date has passed. Choose today or later.";
    if (!d.time) p.time = "Choose the start time.";
    if (d.multiDay) {
      if (!d.endDate) p.endDate = "Choose the last day.";
      else if (d.date && d.endDate <= d.date) p.endDate = "The last day must be after the first.";
    }
    if (d.repeat === "dates" && !d.dates.length) p.dates = "Add at least one more date, or choose “Just once”.";
    if (d.repeat === "dates" && d.dates.some((x) => x <= d.date)) p.dates = "Extra dates must come after the first date.";
  }
  if (step === "tickets") {
    if (!d.access) p.access = "Choose how people get in.";
    if (d.access === "ticketed") {
      if (!d.tiers.length) p.tiers = "Add at least one ticket type.";
      d.tiers.forEach((t, i) => {
        if (!t.name.trim()) p[`tier${i}`] = "Name this ticket (e.g. Regular).";
        else if (!(num(t.price) >= 0)) p[`tier${i}`] = "Add its price (0 for free).";
        else text(`tier${i}`, t.name);
      });
      if (!d.currency) p.currency = "Choose the currency.";
    }
    if (d.ticketUrl.trim() && !cleanUrl(d.ticketUrl)) p.ticketUrl = "That doesn't look like a web address.";
    if (d.capacity.trim() && !(Number.isInteger(Number(d.capacity)) && Number(d.capacity) > 0)) p.capacity = "A whole number of people.";
  }
  if (step === "details") {
    const n = d.description.trim().length;
    if (n < LIMITS.description[0]) p.description = `Write a little more: at least ${LIMITS.description[0]} characters (you have ${n}).`;
    else if (n > LIMITS.description[1]) p.description = `Keep it under ${LIMITS.description[1]} characters.`;
    else text("description", d.description);
    for (const name of d.performers) text("performers", name);
    d.programme.forEach((it, i) => {
      if (!it.time || it.title.trim().length < 2) p[`prog${i}`] = "Give this item a time and a few words, or remove it.";
      else text(`prog${i}`, it.title);
    });
  }
  if (step === "look") {
    if (d.look === "photo" && !cleanUrl(d.imageUrl, { https: true })) p.imageUrl = d.imageUrl.trim() ? "The picture's address must start with https://." : "Paste your picture's address, or pick a poster style.";
  }
  if (step === "publish") {
    if (d.organiserName.trim().length < LIMITS.organiser[0]) p.organiserName = "Who organises it? A name, a collective, a venue…";
    if (d.organiserUrl.trim() && !cleanUrl(d.organiserUrl)) p.organiserUrl = "That doesn't look like a web address.";
    if (d.website.trim() && !cleanUrl(d.website)) p.website = "That doesn't look like a web address.";
    if (!d.agree) p.agree = "Confirm that you may list it.";
  }
  return p;
}

/** The first step with something to fix, if any. */
export function firstProblem(d: Draft): StepId | undefined {
  return STEPS.find((s) => Object.keys(problems(s.id, d)).length)?.id;
}

/** What the server expects. */
export function toInput(d: Draft): UserEventInput {
  const n = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(",", ".")));
  const tiers = d.access === "ticketed" ? d.tiers.filter((t) => t.name.trim() && t.price.trim() !== "").map((t) => ({ name: t.name.trim(), price: Number(t.price.replace(",", ".")) })) : undefined;
  return {
    title: d.title.trim(),
    category: d.category || d.group,
    tagline: d.tagline.trim() || undefined,
    description: d.description.trim(),
    genres: d.genres,
    performers: d.performers,
    date: d.date,
    time: d.time,
    endDate: d.multiDay ? d.endDate : undefined,
    endTime: d.endTime || undefined,
    repeat: d.multiDay || d.repeat === "none" ? { kind: "none" } : d.repeat === "weekly" ? { kind: "weekly", weeks: d.weeks } : { kind: "dates", dates: d.dates },
    venue: { name: d.venue.name.trim(), address: d.venue.address.trim() || undefined, city: d.venue.city.trim(), country: d.venue.country.trim(), countryCode: d.venue.countryCode || undefined, lat: d.venue.lat!, lng: d.venue.lng! },
    access: (d.access || "free") as AccessKind,
    tiers,
    priceMin: tiers?.length ? Math.min(...tiers.map((t) => t.price)) : undefined,
    currency: d.access === "ticketed" ? d.currency : undefined,
    ticketUrl: d.ticketUrl.trim() || undefined,
    soldOut: d.access !== "free" && d.soldOut,
    capacity: n(d.capacity),
    ageMin: d.ageMin,
    familyFriendly: d.ageMin < 16 && d.familyFriendly,
    accessibility: d.accessibility,
    languages: d.languages,
    programme: d.programme.filter((p) => p.time && p.title.trim()).map((p) => ({ time: p.time, title: p.title.trim() })),
    imageUrl: d.look === "photo" ? d.imageUrl.trim() || undefined : undefined,
    posterStyle: d.look === "photo" ? undefined : d.look,
    hue: d.hue,
    organiser: { name: d.organiserName.trim(), url: d.organiserUrl.trim() || undefined },
    website: d.website.trim() || undefined,
    agree: d.agree,
  };
}

/** An owner's saved event, back into the questionnaire. */
export function fromInput(e: UserEventInput): Draft {
  const s = (v?: number) => (v == null ? "" : String(v));
  const tiers = e.tiers?.length
    ? e.tiers.map((t) => ({ name: t.name, price: String(t.price) }))
    : e.priceMin != null
      ? [{ name: "Standard", price: s(e.priceMin) }, ...(e.priceMax != null ? [{ name: "Top price", price: s(e.priceMax) }] : [])]
      : [{ name: "Standard", price: "" }];
  return {
    ...emptyDraft(),
    title: e.title,
    group: groupOf(e.category),
    category: getCategory(e.category)?.parent ? e.category : "",
    tagline: e.tagline ?? "",
    description: e.description,
    genres: e.genres,
    performers: e.performers,
    date: e.date,
    time: e.time,
    endTime: e.endTime ?? "",
    multiDay: !!e.endDate,
    endDate: e.endDate ?? "",
    repeat: e.repeat.kind,
    weeks: e.repeat.kind === "weekly" ? e.repeat.weeks : 4,
    dates: e.repeat.kind === "dates" ? e.repeat.dates : [],
    venue: { name: e.venue.name, address: e.venue.address ?? "", city: e.venue.city, country: e.venue.country, countryCode: e.venue.countryCode ?? "", lat: e.venue.lat, lng: e.venue.lng },
    access: e.access,
    tiers,
    currency: e.currency ?? "",
    ticketUrl: e.ticketUrl ?? "",
    soldOut: !!e.soldOut,
    capacity: s(e.capacity),
    ageMin: e.ageMin,
    familyFriendly: e.familyFriendly,
    accessibility: e.accessibility,
    languages: e.languages,
    programme: e.programme ?? [],
    look: e.imageUrl ? "photo" : (e.posterStyle ?? "bold"),
    imageUrl: e.imageUrl ?? "",
    hue: e.hue,
    organiserName: e.organiser.name,
    organiserUrl: e.organiser.url ?? "",
    website: e.website ?? "",
    agree: false,
  };
}

/** A Studio template's head start. */
export function applyTemplate(d: Draft, t: StudioTemplate): Draft {
  return {
    ...d,
    group: t.group,
    category: t.category ?? "",
    genres: t.genres,
    time: t.time,
    endTime: t.endTime ?? "",
    repeat: t.repeat ?? "none",
    weeks: 4,
    access: t.access,
    tiers: t.tiers ? t.tiers.map((x) => ({ name: x.name, price: String(x.price) })) : d.tiers,
    ageMin: t.ageMin ?? 0,
    familyFriendly: !!t.familyFriendly,
    programme: t.programme ?? [],
    description: d.description || t.description,
    look: t.posterStyle,
    hue: t.hue,
  };
}

/** What magic paste found, filled in. */
export function applyExtracted(d: Draft, x: Extracted): Draft {
  const prices = x.prices;
  const tiers =
    prices.length === 0 ? d.tiers : prices.length === 1 ? [{ name: "Standard", price: String(prices[0]) }] : [{ name: "Advance", price: String(prices[0]) }, { name: "At the door", price: String(prices[prices.length - 1]) }];
  return {
    ...d,
    title: x.title ?? d.title,
    description: x.description ?? d.description,
    date: x.date && x.date >= todayLocal() ? x.date : d.date,
    time: x.time ?? d.time,
    endTime: x.endTime ?? d.endTime,
    access: prices.length ? "ticketed" : x.free ? "free" : d.access,
    tiers,
    currency: x.currency ?? d.currency,
    venue: { ...d.venue, name: x.venueName ?? d.venue.name },
    placeQuery: x.placeQuery ?? x.venueName ?? "",
    ticketUrl: x.ticketUrl ?? d.ticketUrl,
    organiserUrl: x.organiserUrl ?? d.organiserUrl,
    website: x.website ?? d.website,
    group: x.group ?? d.group,
    category: x.category ?? d.category,
    genres: x.genres.length ? x.genres : d.genres,
    performers: x.performers.length ? x.performers : d.performers,
    ageMin: x.ageMin ?? d.ageMin,
  };
}

/** The poster's words, from the answers. */
export function posterDataOf(d: Draft): PosterData {
  const w = posterWhen(d.date || undefined, d.time || undefined);
  const prices = d.tiers.map((t) => num(t.price)).filter((x) => Number.isFinite(x));
  let price: string | undefined;
  if (d.access === "free") price = "FREE";
  else if (d.access === "registration") price = "FREE · SIGN UP";
  else if (d.access === "ticketed" && prices.length) {
    const lo = Math.min(...prices);
    try {
      price = `${prices.length > 1 ? "FROM " : ""}${new Intl.NumberFormat("en-GB", { style: "currency", currency: d.currency || "EUR", maximumFractionDigits: lo % 1 ? 2 : 0, minimumFractionDigits: lo % 1 ? 2 : 0 }).format(lo)}`;
    } catch {
      price = String(lo);
    }
  }
  return {
    title: d.title,
    tagline: d.tagline || undefined,
    date: w.date,
    time: w.time,
    venue: d.venue.name || undefined,
    city: d.venue.city || undefined,
    price,
    category: getCategory(d.category || d.group)?.name,
    hue: d.hue,
  };
}

/** The usual currency where the event is. */
export const currencyFor = (countryCode: string) => (countryCode ? getCountry(countryCode)?.currency : undefined) ?? "";
