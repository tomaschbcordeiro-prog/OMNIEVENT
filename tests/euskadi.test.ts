import { describe, expect, it } from "vitest";
import { normalizeEuskadi, type EusEvent } from "@/lib/providers/euskadi";
import ROWS from "./fixtures/euskadi.json";

describe("Kulturklik (Basque Country)", () => {
  const now = Date.parse("2026-10-25T08:00:00Z");
  const table = { "Auditorio Baluarte|Pamplona/Iruña": { lat: 42.8137, lng: -1.6491 }, "Civivox Pompelo|Pamplona/Iruña": null };
  const out = normalizeEuskadi(ROWS as EusEvent[], "2026-10-25T08:00:00Z", now, table);
  const byTitle = (t: string) => out.events.find((e) => e.title.startsWith(t))!;
  const venue = (id: string) => out.venues.find((v) => v.id === id)!;

  it("places located venues exactly and the rest at the town centre, saying so", () => {
    const a = byTitle("Anastacia");
    expect(venue(a.venueId)).toMatchObject({ name: "Auditorio Baluarte", lat: 42.8137, countryCode: "ES" });
    expect(venue(a.venueId).address).toBeUndefined();
    const m = byTitle("Muestra de Teatro");
    expect(venue(m.venueId).address).toMatch(/shown at the centre of Pamplona/);
    const b = byTitle("Programa BAD");
    expect(venue(b.venueId).name).toBe("Bilbao (venue not published)");
  });

  it("reads time, price, country and registration", () => {
    const a = byTitle("Anastacia");
    expect(a.start).toBe("2026-10-25T20:00:00.000Z"); // 21:00 CET
    expect(out.offers.find((o) => o.eventId === a.id)).toMatchObject({ basePrice: 71.5, currency: "EUR" });
    const fr = byTitle("Julen Magoa");
    expect(venue(fr.venueId)).toMatchObject({ countryCode: "FR", timeZone: "Europe/Paris" });
    const m = byTitle("Muestra de Teatro");
    expect(m).toMatchObject({ isFree: true, ticketAccess: "registration", registrationRequired: true });
    const b = byTitle("Programa BAD");
    expect(b).toMatchObject({ eventType: "multi_day", hoursUnknown: true });
  });
});
