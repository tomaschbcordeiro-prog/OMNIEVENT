import { getCategory, groupOf } from "@/lib/categories";
import { getCountry } from "@/lib/destinations";
import { cleanUrl, LIMITS, listingTextProblem, type AccessKind, type UserEventInput } from "@/lib/user-events-shared";

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
  access: AccessKind | "";
  priceMin: string;
  priceMax: string;
  currency: string;
  ticketUrl: string;
  soldOut: boolean;
  capacity: string;
  ageMin: number;
  familyFriendly: boolean;
  accessibility: string[];
  languages: string[];
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
  access: "",
  priceMin: "",
  priceMax: "",
  currency: "",
  ticketUrl: "",
  soldOut: false,
  capacity: "",
  ageMin: 0,
  familyFriendly: false,
  accessibility: [],
  languages: [],
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
  { id: "tickets", label: "Tickets", title: "How do people get in?", lede: "Free, paid or sign-up first: say what it costs and where to get tickets." },
  { id: "details", label: "Details", title: "Tell people more", lede: "What to expect, who's on, and who it's for." },
  { id: "look", label: "Look", title: "Make it look good", lede: "A picture gets far more people to open your event." },
  { id: "publish", label: "Publish", title: "Check and publish", lede: "One last look before it goes live for everyone." },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

const pad = (n: number) => String(n).padStart(2, "0");
export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const numOrNaN = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(",", ".")));

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
      const lo = numOrNaN(d.priceMin);
      const hi = numOrNaN(d.priceMax);
      if (!Number.isFinite(lo) || lo < 0) p.priceMin = "Add the ticket price (the lowest, if there are several).";
      if (d.priceMax.trim() && (!Number.isFinite(hi) || hi < lo)) p.priceMax = "The highest price can't be lower than the lowest.";
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
  }
  if (step === "look") {
    if (d.imageUrl.trim() && !cleanUrl(d.imageUrl, { https: true })) p.imageUrl = "The picture's address must start with https://.";
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
    priceMin: d.access === "ticketed" ? n(d.priceMin) : undefined,
    priceMax: d.access === "ticketed" ? n(d.priceMax) : undefined,
    currency: d.access === "ticketed" ? d.currency : undefined,
    ticketUrl: d.ticketUrl.trim() || undefined,
    soldOut: d.access !== "free" && d.soldOut,
    capacity: n(d.capacity),
    ageMin: d.ageMin,
    familyFriendly: d.ageMin < 16 && d.familyFriendly,
    accessibility: d.accessibility,
    languages: d.languages,
    imageUrl: d.imageUrl.trim() || undefined,
    hue: d.hue,
    organiser: { name: d.organiserName.trim(), url: d.organiserUrl.trim() || undefined },
    website: d.website.trim() || undefined,
    agree: d.agree,
  };
}

/** An owner's saved event, back into the questionnaire. */
export function fromInput(e: UserEventInput): Draft {
  const s = (v?: number) => (v == null ? "" : String(v));
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
    priceMin: s(e.priceMin),
    priceMax: s(e.priceMax),
    currency: e.currency ?? "",
    ticketUrl: e.ticketUrl ?? "",
    soldOut: !!e.soldOut,
    capacity: s(e.capacity),
    ageMin: e.ageMin,
    familyFriendly: e.familyFriendly,
    accessibility: e.accessibility,
    languages: e.languages,
    imageUrl: e.imageUrl ?? "",
    hue: e.hue,
    organiserName: e.organiser.name,
    organiserUrl: e.organiser.url ?? "",
    website: e.website ?? "",
    agree: false,
  };
}

/** The usual currency where the event is. */
export const currencyFor = (countryCode: string) => (countryCode ? getCountry(countryCode)?.currency : undefined) ?? "";
