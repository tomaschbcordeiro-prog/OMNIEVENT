import type { CurrencyCode, EventStatus, TicketAccess, Availability, TicketCategory } from "./types";

/** Locale-aware formatting. All event times render in the event's own time zone. */

export function formatEventDate(iso: string, timeZone: string, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(iso));
}

export function formatEventTime(iso: string, timeZone: string, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
}

export function formatShortDate(iso: string, timeZone: string, locale = "en-GB"): { day: string; month: string; weekday: string } {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", weekday: "short", timeZone }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: get("day"), month: get("month").replace(".", ""), weekday: get("weekday").replace(".", "") };
}

export function tzAbbrev(iso: string, timeZone: string, locale = "en-GB"): string {
  const parts = new Intl.DateTimeFormat(locale, { timeZoneName: "short", timeZone }).formatToParts(new Date(iso));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

export function formatMoney(amount: number, currency: CurrencyCode, locale = "en-GB"): string {
  const zeroDecimal = ["JPY", "KRW", "CLP", "IDR", "HUF", "COP", "TWD"].includes(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: zeroDecimal ? 0 : amount % 1 === 0 ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(amount);
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export function formatDistance(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString("en")} km`;
}

const ymdFormatters = new Map<string, Intl.DateTimeFormat>();
function ymdFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = ymdFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
    ymdFormatters.set(timeZone, f);
  }
  return f;
}

/** YYYY-MM-DD of an instant as seen in a given time zone (en-CA formats as YYYY-MM-DD). */
export function localDateKey(iso: string | Date, timeZone: string): string {
  return ymdFormatter(timeZone).format(typeof iso === "string" ? new Date(iso) : iso);
}

export const STATUS_META: Record<EventStatus, { label: string; tone: "ok" | "warn" | "bad" | "info" | "muted" }> = {
  scheduled: { label: "Scheduled", tone: "info" },
  on_sale: { label: "On sale", tone: "ok" },
  sold_out: { label: "Sold out", tone: "bad" },
  postponed: { label: "Postponed", tone: "warn" },
  rescheduled: { label: "Rescheduled", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "bad" },
  completed: { label: "Completed", tone: "muted" },
  free_entry: { label: "Free entry", tone: "ok" },
  registration_required: { label: "Registration required", tone: "info" },
  unknown: { label: "Ticket status unknown", tone: "muted" },
};

export const ACCESS_META: Record<TicketAccess, string> = {
  ticketed: "Ticketed",
  free: "Free entry",
  registration: "Registration required",
  invitation_only: "Invitation only",
  unknown: "Ticket status unknown",
};

export const AVAILABILITY_META: Record<Availability, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  available: { label: "Available", tone: "ok" },
  limited: { label: "Limited", tone: "warn" },
  sold_out: { label: "Sold out", tone: "bad" },
  not_on_sale: { label: "Not on sale yet", tone: "muted" },
  unknown: { label: "Availability unknown", tone: "muted" },
};

export const TICKET_CATEGORY_LABEL: Record<TicketCategory, string> = {
  general_admission: "General admission",
  reserved: "Reserved seating",
  vip: "VIP",
  premium: "Premium",
  hospitality: "Hospitality",
  family: "Family ticket",
  child: "Child",
  student: "Student",
  group: "Group",
  accessible: "Accessible seating",
  day_pass: "Day pass",
  multi_day_pass: "Multi-day pass",
  season: "Season ticket",
  standard: "Standard",
};
