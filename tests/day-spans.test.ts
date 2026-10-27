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
    for (const f of ranges)
      for (const e of events) {
        expect([e.id, f.from, __testing.matchesWhen(e, f)]).toEqual([e.id, f.from, __testing.matchesWhenSlow(e, f)]);
        compared++;
      }
    expect(compared).toBeGreaterThan(5000);
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
