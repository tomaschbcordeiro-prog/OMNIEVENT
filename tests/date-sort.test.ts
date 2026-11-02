import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { ensureFresh, searchEvents } from "@/lib/store";
import type { EventCard } from "@/lib/types";

/**
 * Date order is the order of the start times shown, also for events in time zones ahead of
 * UTC, which often start on the previous UTC day (a Melbourne marathon at 08:30 on the 4th
 * starts at 21:30 UTC on the 3rd). The clock is fixed at a time when the demo data has
 * such events, so the check doesn't depend on when the tests run.
 */

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T18:47:00Z"));
  delete process.env.TICKETMASTER_API_KEY;
  process.env.DISABLED_PROVIDERS = "paris,madrid,lisbon,venue-calendars,football,bol,catalonia,euskadi,castilla-leon,cultura-portugal,openagenda,nyc-parks,zaragoza,helsinki,taiwan,montreal,berlin,barcelona,chicago,valencia-ivc,espoo,brisbane,localist,pt-municipios,livewhale,mapas-culturais,wikidata";
  await ensureFresh();
});
afterAll(() => vi.useRealTimers());

function all(from: string, to: string): EventCard[] {
  const out: EventCard[] = [];
  for (let page = 1; ; page++) {
    const r = searchEvents({ from, to, sort: "date", page, pageSize: 100 });
    out.push(...r.items);
    if (page >= r.pages) return out;
  }
}

describe("date order", () => {
  it.each([
    ["2026-11-04", "2026-11-10"],
    ["2026-11-04", "2026-11-04"],
  ])("follows the start times shown, %s to %s", (from, to) => {
    const items = all(from, to).filter((c) => !c.ongoing && !c.hoursUnknown && c.eventType !== "daily_attraction");
    expect(items.length).toBeGreaterThan(10);
    // Some results start before midnight UTC of the first day, though on it where they are.
    expect(items.some((c) => Date.parse(c.start) < Date.parse(`${from}T00:00:00Z`))).toBe(true);
    for (let i = 1; i < items.length; i++) expect([items[i].title, Date.parse(items[i].start) >= Date.parse(items[i - 1].start)]).toEqual([items[i].title, true]);
  });
});
