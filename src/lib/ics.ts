import type { EventView } from "./types";

/** Text as iCalendar wants it: backslashes, semicolons, commas and line breaks escaped. */
export const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** One event as a VEVENT (times in UTC, which every calendar converts). */
export function vevent(e: EventView, url: string): string[] {
  const end = e.end ?? new Date(new Date(e.start).getTime() + (e.durationMinutes ?? 120) * 60000).toISOString();
  return [
    "BEGIN:VEVENT",
    `UID:${e.id}@omnievent`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${icsText(e.title + (e.provenance.isDemo ? " (demo)" : ""))}`,
    `LOCATION:${icsText([e.venue.name, e.venue.address, e.venue.city, e.venue.country].filter(Boolean).join(", "))}`,
    `GEO:${e.venue.lat};${e.venue.lng}`,
    `URL:${url}`,
    `DESCRIPTION:${icsText(`${e.description ?? ""}\n\n${url}`)}`,
    e.status === "cancelled" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "END:VEVENT",
  ];
}

export function calendar(events: string[][]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OMNIEVENT//EN", "CALSCALE:GREGORIAN", ...events.flat(), "END:VCALENDAR"].join("\r\n");
}
