import { describe, it, expect, beforeAll } from "vitest";
import { ensureFresh, sampleEvents } from "@/lib/store";
import { descendantsOf } from "@/lib/categories";
import { localDateKey } from "@/lib/format";
import { spinQuery } from "@/components/earth/globe-spin";

/** "Spin the globe": a random handful of matching events, spread over the planet. */

beforeAll(async () => {
  delete process.env.TICKETMASTER_API_KEY;
  process.env.DISABLED_PROVIDERS = "paris,madrid,lisbon,venue-calendars,football,bol,catalonia,euskadi,castilla-leon,cultura-portugal,openagenda,nyc-parks,zaragoza,helsinki,taiwan,montreal,berlin,barcelona,chicago,valencia-ivc,espoo,brisbane,localist,pt-municipios,livewhale,mapas-culturais,wikidata";
  await ensureFresh();
});

/** A seeded random, so a test can repeat a draw. */
const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

describe("spinning the globe", () => {
  it("draws the number asked for, each from a different city", () => {
    const items = sampleEvents({}, 12, seeded(1));
    expect(items).toHaveLength(12);
    expect(new Set(items.map((c) => c.cityId ?? c.city)).size).toBe(12);
    expect(new Set(items.map((c) => c.id)).size).toBe(12);
  });
  it("lands somewhere new on another draw, and the same place with the same luck", () => {
    expect(sampleEvents({}, 8, seeded(2)).map((c) => c.id)).toEqual(sampleEvents({}, 8, seeded(2)).map((c) => c.id));
    expect(sampleEvents({}, 8, seeded(2)).map((c) => c.id)).not.toEqual(sampleEvents({}, 8, seeded(3)).map((c) => c.id));
  });
  it("only draws what the vibe and the days allow", () => {
    const from = ymd(Date.now() + 2 * 864e5);
    const to = ymd(Date.now() + 4 * 864e5);
    const music = descendantsOf("music");
    const items = sampleEvents({ categories: ["music"], from, to }, 10, seeded(4));
    expect(items.length).toBeGreaterThan(3);
    for (const c of items) {
      expect(music.has(c.categorySlug)).toBe(true);
      if (c.eventType !== "daily_attraction" && !c.ongoing) expect(localDateKey(c.start, c.timeZone) >= from && localDateKey(c.start, c.timeZone) <= to).toBe(true);
    }
  });
  it("never draws cancelled, postponed or online events", () => {
    for (const c of sampleEvents({}, 24, seeded(5))) {
      expect(["cancelled", "postponed"]).not.toContain(c.status);
      expect(c.online).toBe(false);
    }
  });
  it("asks for tonight, this weekend or this week in the visitor's calendar", () => {
    const tonight = new URLSearchParams(spinQuery("tonight", "music"));
    expect(tonight.get("from")).toBe(tonight.get("to"));
    expect(tonight.get("tfrom")).toBe("17:00");
    expect(tonight.get("cat")).toBe("music");
    const party = new URLSearchParams(spinQuery("week", "party"));
    expect(party.get("cat")).toBe("nightlife,festivals");
    expect(Date.parse(party.get("to")!) - Date.parse(party.get("from")!)).toBe(6 * 864e5);
    expect(new URLSearchParams(spinQuery("week", "any")).has("cat")).toBe(false);
  });
});
