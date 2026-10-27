import { describe, it, expect } from "vitest";
import { __testing } from "@/lib/store";
import { generateDemoData } from "@/lib/providers/demo";
import type { OmniEvent } from "@/lib/types";

const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

describe("whole-day date matching", () => {
  it("agrees with the general (time-window) matcher on every demo event", () => {
    const { events } = generateDemoData(new Date("2026-10-22T10:00:00Z"));
    const base = Date.parse("2026-10-22T12:00:00Z");
    const ranges = [
      { from: ymd(base), to: ymd(base) },
      { from: ymd(base + 864e5), to: ymd(base + 864e5) },
      { from: ymd(base + 2 * 864e5), to: ymd(base + 4 * 864e5) },
      { from: ymd(base + 10 * 864e5), to: ymd(base + 40 * 864e5) },
      { from: ymd(base - 3 * 864e5), to: ymd(base - 864e5) },
    ];
    let compared = 0;
    // Performances past midnight belong to their start day here; the general matcher (used
    // for local time windows) also sees them after midnight, so they're compared separately.
    const overnight = (e: OmniEvent) => {
      const end = e.end ? Date.parse(e.end) : Date.parse(e.start) + (e.durationMinutes ?? 120) * 60000;
      return new Date(Date.parse(e.start)).toLocaleDateString("en-CA", { timeZone: e.timeZone }) !== new Date(end - 1).toLocaleDateString("en-CA", { timeZone: e.timeZone });
    };
    for (const f of ranges)
      for (const e of events.filter((x) => x.eventType === "daily_attraction" || !overnight(x))) {
        expect([e.id, f.from, __testing.matchesWhen(e, f)]).toEqual([e.id, f.from, __testing.matchesWhenSlow(e, f)]);
        compared++;
      }
    expect(compared).toBeGreaterThan(5000);
  });
  it("puts a performance past midnight on the day it starts", () => {
    const club = { id: "c", start: "2026-10-27T23:30:00Z", end: "2026-10-28T05:00:00Z", eventType: "single", timeZone: "Europe/London" } as OmniEvent;
    expect(__testing.matchesWhen(club, { from: "2026-10-27", to: "2026-10-27" })).toBe(true);
    expect(__testing.matchesWhen(club, { from: "2026-10-28", to: "2026-10-28" })).toBe(false);
    const festival = { ...club, end: "2026-10-30T05:00:00Z", eventType: "multi_day" } as OmniEvent;
    expect(__testing.matchesWhen(festival, { from: "2026-10-29", to: "2026-10-29" })).toBe(true);
  });
  it("handles late-night shows by the venue's local day, across time zones", () => {
    const e = { id: "x", start: "2026-10-30T23:30:00Z", end: "2026-10-31T02:00:00Z", eventType: "single", timeZone: "America/New_York" } as OmniEvent;
    // 19:30–22:00 on 30 October in New York.
    expect(__testing.matchesWhen(e, { from: "2026-10-30", to: "2026-10-30" })).toBe(true);
    expect(__testing.matchesWhen(e, { from: "2026-10-31", to: "2026-10-31" })).toBe(false);
    const tokyo = { ...e, timeZone: "Asia/Tokyo" };
    // 08:30–11:00 on 31 October in Tokyo.
    expect(__testing.matchesWhen(tokyo, { from: "2026-10-30", to: "2026-10-30" })).toBe(false);
    expect(__testing.matchesWhen(tokyo, { from: "2026-10-31", to: "2026-10-31" })).toBe(true);
  });
});

import { setRangeEdge } from "@/lib/date-range";
describe("date range fields", () => {
  it("fill the end from the start and keep the range in order", () => {
    expect(setRangeEdge("from", "2026-10-31", {})).toEqual({ from: "2026-10-31", to: "2026-10-31" });
    expect(setRangeEdge("from", "2026-10-31", { to: "2026-11-05" })).toEqual({ from: "2026-10-31", to: "2026-11-05" });
    expect(setRangeEdge("from", "2026-11-10", { to: "2026-11-05" })).toEqual({ from: "2026-11-10", to: "2026-11-10" });
    expect(setRangeEdge("to", "2026-10-20", { from: "2026-10-31", to: "2026-10-31" })).toEqual({ from: "2026-10-20", to: "2026-10-20" });
    expect(setRangeEdge("from", "", { from: "2026-10-31", to: "2026-11-02" })).toEqual({ from: undefined, to: "2026-11-02" });
  });
});
