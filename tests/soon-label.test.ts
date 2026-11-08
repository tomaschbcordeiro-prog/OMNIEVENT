import { describe, expect, it } from "vitest";
import { soonLabel } from "@/components/event-list-parts";

describe("soonLabel", () => {
  const now = new Date("2026-11-08T10:00:00Z");
  const tz = "Europe/Lisbon";
  it("counts by the event's own calendar", () => {
    expect(soonLabel({ start: "2026-11-08T21:00:00Z", timeZone: tz }, now)).toBe("Today");
    expect(soonLabel({ start: "2026-11-09T00:30:00Z", timeZone: tz }, now)).toBe("Tomorrow");
    expect(soonLabel({ start: "2026-11-13T21:30:00Z", timeZone: tz }, now)).toBe("In 5 days");
    expect(soonLabel({ start: "2026-11-30T20:00:00Z", timeZone: tz }, now)).toBe("In 3 weeks");
    expect(soonLabel({ start: "2027-02-08T20:00:00Z", timeZone: tz }, now)).toBe("In 3 months");
  });
  it("says when it's already on", () => {
    expect(soonLabel({ start: "2026-11-08T09:00:00Z", timeZone: tz }, now)).toBe("On now");
    expect(soonLabel({ start: "2026-10-01T09:00:00Z", timeZone: tz, ongoing: true }, now)).toBe("On now");
  });
  it("uses the event's time zone, not the server's", () => {
    // 23:30 on the 8th in New York is already the 9th in UTC.
    expect(soonLabel({ start: "2026-11-09T04:30:00Z", timeZone: "America/New_York" }, now)).toBe("Today");
  });
});
