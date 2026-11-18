import { isDull } from "@/lib/quality";
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
    expectDateOrder(items);
  });
});

/** Day by day (UTC days, as the search sorts); within a day, by start time, except that listings few go out for (job fairs, information sessions) come after the rest of their day. */
function expectDateOrder(items: { title: string; start: string; venueName: string; categorySlug: string; groupSlug: string; imageUrl?: string }[]) {
  const day = (c: { start: string }) => Math.floor(Date.parse(c.start) / 86_400_000);
  for (let i = 1; i < items.length; i++) {
    const [a, b] = [items[i - 1], items[i]];
    expect([b.title, day(b) >= day(a)]).toEqual([b.title, true]);
    if (day(a) === day(b) && isDull(a) === isDull(b)) expect([b.title, Date.parse(b.start) >= Date.parse(a.start)]).toEqual([b.title, true]);
    if (day(a) === day(b)) expect([b.title, !(isDull(a) && !isDull(b))]).toEqual([b.title, true]);
  }
}
