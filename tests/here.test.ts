import { beforeAll, describe, expect, it } from "vitest";
import { hereCookieValue, parseHereCookie } from "@/lib/here-shared";
import { hereCityById, nearestCity } from "@/lib/here";
import { cityStats, ensureFresh } from "@/lib/store";
import { getDestination } from "@/lib/destinations";
import { haversineKm } from "@/lib/geo";

/** "Here": the city the site opens on, from the visitor's connection, device or choice. */

describe("the location cookie", () => {
  it("holds a city and how it was found, or 'any'", () => {
    expect(parseHereCookie(hereCookieValue({ id: "lisbon", source: "gps" }))).toEqual({ id: "lisbon", source: "gps" });
    expect(parseHereCookie(hereCookieValue({ id: "porto", source: "chosen" }))).toEqual({ id: "porto", source: "chosen" });
    expect(parseHereCookie("any")).toBe("any");
  });
  it("ignores anything else", () => {
    expect(parseHereCookie(undefined)).toBeNull();
    expect(parseHereCookie("")).toBeNull();
    expect(parseHereCookie("../etc~gps")).toBeNull();
    expect(parseHereCookie("LISBON")).toBeNull();
    expect(parseHereCookie("lisbon~admin")).toEqual({ id: "lisbon", source: "chosen" });
  });
});

describe("the nearest city with events", () => {
  beforeAll(async () => {
    delete process.env.TICKETMASTER_API_KEY;
    process.env.DISABLED_PROVIDERS = "paris,madrid,lisbon,venue-calendars,football,bol,catalonia,euskadi,castilla-leon,cultura-portugal,openagenda,nyc-parks,zaragoza,helsinki,taiwan,montreal,berlin,barcelona,chicago,valencia-ivc,espoo,brisbane,localist,pt-municipios,livewhale,mapas-culturais,wikidata";
    await ensureFresh();
  });

  it("finds a busy city close to a point, and nothing in mid-ocean", () => {
    const stats = cityStats();
    const [busiest] = Object.entries(stats).sort((a, b) => b[1].total - a[1].total)[0];
    const d = getDestination(busiest)!;
    // A few km off the centre still lands on it.
    const near = nearestCity(d.lat + 0.05, d.lng + 0.05);
    expect(near).not.toBeNull();
    expect(haversineKm(near!.lat, near!.lng, d.lat, d.lng)).toBeLessThan(80);
    expect(near!.n).toBeGreaterThanOrEqual(15);
    expect(nearestCity(-45, -140)).toBeNull();
    expect(nearestCity(NaN, 0)).toBeNull();
  });

  it("looks cities up by id", () => {
    expect(hereCityById("lisbon")?.name).toBe("Lisbon");
    expect(hereCityById("portugal")).toBeNull();
    expect(hereCityById("atlantis")).toBeNull();
  });
});
