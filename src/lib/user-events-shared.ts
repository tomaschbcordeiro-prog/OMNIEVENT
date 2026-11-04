/**
 * Listing an event yourself: the choices and rules shared by the questionnaire (which guides
 * and warns while you fill it in) and the server (which enforces them).
 */

export const ACCESSIBILITY_OPTIONS = [
  "Wheelchair accessible",
  "Step-free access",
  "Accessible toilets",
  "Hearing loop",
  "Sign language interpretation",
  "Seating available",
  "Quiet space",
  "Assistance dogs welcome",
] as const;

export const AGE_OPTIONS = [
  { min: 0, label: "All ages" },
  { min: 6, label: "6+" },
  { min: 12, label: "12+" },
  { min: 16, label: "16+" },
  { min: 18, label: "18+" },
  { min: 21, label: "21+" },
] as const;

export const ACCESS_KINDS = [
  { id: "free", label: "Free", hint: "Anyone can just turn up", emoji: "🎉" },
  { id: "ticketed", label: "Paid tickets", hint: "People buy a ticket", emoji: "🎟️" },
  { id: "registration", label: "Free, sign up first", hint: "Places must be booked", emoji: "📝" },
] as const;
export type AccessKind = (typeof ACCESS_KINDS)[number]["id"];

export const LIMITS = {
  title: [3, 120],
  tagline: 140,
  description: [30, 5000],
  genres: 8,
  performers: 20,
  extraDates: 30,
  weeks: [2, 26],
  venueName: [2, 120],
  address: 200,
  organiser: [2, 80],
  price: 100000,
  tiers: 6,
  tierName: 40,
  programme: 12,
  programmeTitle: 80,
} as const;

export const POSTER_STYLE_IDS = ["bold", "minimal", "neon", "retro"] as const;

/** What the questionnaire sends, and what an owner gets back to edit. */
export interface UserEventInput {
  title: string;
  category: string;
  tagline?: string;
  description: string;
  genres: string[];
  performers: string[];
  /** Local calendar day and time at the venue. */
  date: string;
  time: string;
  endDate?: string;
  endTime?: string;
  repeat: { kind: "none" } | { kind: "weekly"; weeks: number } | { kind: "dates"; dates: string[] };
  venue: { name: string; address?: string; city: string; country: string; countryCode?: string; lat: number; lng: number };
  access: AccessKind;
  priceMin?: number;
  priceMax?: number;
  /** Ticket types (Early bird, Regular, VIP…); the prices above follow from them. */
  tiers?: { name: string; price: number }[];
  currency?: string;
  ticketUrl?: string;
  soldOut?: boolean;
  capacity?: number;
  ageMin: number;
  familyFriendly: boolean;
  accessibility: string[];
  languages: string[];
  imageUrl?: string;
  /** A poster drawn by the Studio, used when there's no picture. */
  posterStyle?: (typeof POSTER_STYLE_IDS)[number];
  hue: number;
  /** The running order: doors, sets, talks… */
  programme?: { time: string; title: string }[];
  organiser: { name: string; url?: string };
  website?: string;
  agree: boolean;
}

/** Money and messaging details that don't belong in a public listing (scams start there). */
const PAYMENT_RE = /\b(?:mb\s?way|paypal\.me|iban|bizum|revolut\.me|venmo|cash\s?app|wise\s+transfer)\b/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i;

/** A phone number: nine or more digits in groups (dates and years don't count). */
function hasPhone(text: string): boolean {
  for (const m of text.matchAll(/\+?\(?\d[\d\s().-]{7,}\d/g)) {
    const c = m[0];
    const digits = c.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) continue;
    const groups = c.split(/[\s().+-]+/).filter(Boolean);
    if (groups.every((g) => /^(?:19|20)\d\d$/.test(g))) continue;
    if (c.startsWith("+") || groups.every((g) => g.length >= 3)) return true;
  }
  return false;
}

/** Why a public text can't be published as it is, if it can't. */
export function listingTextProblem(text: string): string | undefined {
  if (PAYMENT_RE.test(text)) return "Payment details don't belong in a listing. Add a ticket link instead, so people pay through a proper checkout.";
  if (EMAIL_RE.test(text) || hasPhone(text)) return "Keep phone numbers and emails out of the public text. Add your website or a ticket link instead.";
  if ((text.match(/https?:\/\//g) ?? []).length > 3) return "Too many links in the text. Put the main one in the website or ticket link fields.";
  return undefined;
}

/** A web address people can open: http(s) only, normalised, or undefined if it isn't one. */
export function cleanUrl(raw: unknown, { https = false } = {}): string | undefined {
  const s = String(raw ?? "").trim();
  if (!s) return undefined;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    if (u.protocol !== "https:" && (https || u.protocol !== "http:")) return undefined;
    if (!u.hostname.includes(".") || u.username || u.password) return undefined;
    return u.toString().slice(0, 500);
  } catch {
    return undefined;
  }
}
