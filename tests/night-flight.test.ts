import { describe, it, expect, beforeAll } from "vitest";
import { ensureFresh, nightFlight } from "@/lib/store";
import { descendantsOf } from "@/lib/categories";
import { haversineKm } from "@/lib/geo";
import type { EventCard } from "@/lib/types";

/** "Night Flight": a route round the planet through tonight's evenings, east to west. */

beforeAll(async () => {
  delete process.env.TICKETMASTER_API_KEY;
  process.env.DISABLED_PROVIDERS = "paris,madrid,lisbon,venue-calendars,football,bol,catalonia,euskadi,castilla-leon,cultura-portugal,openagenda,nyc-parks,zaragoza,helsinki,taiwan,montreal,berlin,barcelona,chicago,valencia-ivc,espoo,brisbane,localist,pt-municipios,livewhale,mapas-culturais,wikidata";
  await ensureFresh();
});

const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

/** Minutes after local midnight when the stop starts, in the venue's own zone. */
function localMinutes(c: EventCard): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: c.timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(c.start)).map((x) => [x.type, x.value]));
  return +p.hour * 60 + +p.minute;
}

describe("night flight", () => {
  const now = Date.now();
  let route: EventCard[] = [];
  beforeAll(() => {
    route = nightFlight({ n: 10, now, random: seeded(7) });
  });

  it("visits several places, each a different city, never twice the same event", () => {
    expect(route.length).toBeGreaterThan(3);
    expect(route.length).toBeLessThanOrEqual(10);
    expect(new Set(route.map((c) => c.id)).size).toBe(route.length);
    expect(new Set(route.map((c) => c.cityId ?? `${c.city}|${c.country}`)).size).toBe(route.length);
  });

  it("only stops at timed events starting tonight in their local evening", () => {
    for (const c of route) {
      const t = Date.parse(c.start);
      expect([c.title, t >= now - 3600000 && t <= now + 864e5]).toEqual([c.title, true]);
      expect([c.title, localMinutes(c) >= 17 * 60]).toEqual([c.title, true]);
      expect(c.eventType).not.toBe("daily_attraction");
      expect(c.hoursUnknown).toBeFalsy();
      expect(c.online).toBe(false);
      // Without a vibe, nights out only: shows, concerts, matches, parties.
      expect(["music", "theatre", "comedy", "festivals", "nightlife", "sports", "cinema", "food-drink"]).toContain(c.groupSlug);
    }
  });

  it("spreads round the planet and follows nightfall from east to west", () => {
    const bands = new Set(route.map((c) => Math.floor((c.lng + 180) / 30)));
    expect(bands.size).toBeGreaterThan(2);
    // Stops in far-apart places come first: the nearest pair is a real flight, not a hop.
    const near = Math.min(...route.flatMap((a, i) => route.slice(i + 1).map((b) => haversineKm(a.lat, a.lng, b.lat, b.lng))));
    expect(near).toBeGreaterThan(50);
    const dusk = (c: EventCard) => Date.parse(c.start) - (localMinutes(c) - 20 * 60) * 60000;
    for (let i = 1; i < route.length; i++) expect(dusk(route[i])).toBeGreaterThanOrEqual(dusk(route[i - 1]) - 60000);
  });

  it("keeps to the vibe asked for, and repeats with the same luck", () => {
    const music = descendantsOf("music");
    const items = nightFlight({ n: 8, groups: ["music"], now, random: seeded(3) });
    for (const c of items) expect(music.has(c.categorySlug) || music.has(c.groupSlug)).toBe(true);
    expect(nightFlight({ n: 8, now, random: seeded(5) }).map((c) => c.id)).toEqual(nightFlight({ n: 8, now, random: seeded(5) }).map((c) => c.id));
  });
});
