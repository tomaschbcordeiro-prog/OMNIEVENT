import { describe, expect, it } from "vitest";
import { calendar, icsText } from "@/lib/ics";

describe("iCalendar text", () => {
  it("escapes what calendars treat as separators", () => {
    expect(icsText("Rock; Roll, and\\more\nnext line")).toBe("Rock\; Roll\\, and\\\\more\\nnext line");
  });
  it("wraps events in one calendar with CRLF line ends", () => {
    const out = calendar([["BEGIN:VEVENT", "END:VEVENT"], ["BEGIN:VEVENT", "END:VEVENT"]]);
    expect(out.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0")).toBe(true);
    expect(out.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(out.endsWith("END:VCALENDAR")).toBe(true);
  });
});
