import { describe, expect, it } from "vitest";
import { mapOaCategory, normalizeOpenAgenda, type OaRow } from "@/lib/providers/openagenda";

const row = (over: Partial<OaRow> = {}): OaRow => ({
  uid: 68936006,
  canonicalurl: "https://openagenda.com/x/events/concert",
  title_fr: "Concert de l'harmonie",
  conditions_fr: "Tarif plein 8 €, réduit 5 €",
  firstdate_begin: "2026-11-14T19:30:00+00:00",
  firstdate_end: "2026-11-14T21:30:00+00:00",
  lastdate_end: "2026-11-14T21:30:00+00:00",
  location_coordinates: { lat: 47.913872, lon: 2.307504 },
  location_name: "Salle des fêtes",
  location_address: "1 place de la Mairie, 45130 Meung-sur-Loire",
  location_city: "Meung-sur-Loire",
  location_countrycode: "FR",
  attendancemode: '{"id": 1}',
  status: '{"id": 1}',
  ...over,
});

describe("OpenAgenda", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  it("maps keywords to categories", () => {
    expect(mapOaCategory("Spectacle jeune public", [])).toBe("family-shows");
    expect(mapOaCategory("Vide-grenier du village", [])).toBe("street-festivals");
    expect(mapOaCategory("Exposition", ["peinture"])).toBe("art-exhibitions");
  });
  it("normalises a village event with price and venue", () => {
    const out = normalizeOpenAgenda([row()], "x", now);
    expect(out.events[0]).toMatchObject({ title: "Concert de l'harmonie", categorySlug: "concerts", timeZone: "Europe/Paris", start: "2026-11-14T19:30:00.000Z" });
    expect(out.venues[0]).toMatchObject({ name: "Salle des fêtes", city: "Meung-sur-Loire", countryCode: "FR" });
    expect(out.offers[0]).toMatchObject({ basePrice: 8, currency: "EUR" });
  });
  it("skips online, cancelled, past, far-future catalogue entries and duplicates", () => {
    const out = normalizeOpenAgenda(
      [
        row(),
        row(),
        row({ uid: 2, attendancemode: { id: 2 } }),
        row({ uid: 3, status: '{"id": 6}' }),
        row({ uid: 4, firstdate_begin: "2026-01-01T10:00:00+00:00", lastdate_end: "2026-01-01T12:00:00+00:00" }),
        row({ uid: 5, firstdate_begin: "2032-01-01T01:00:00+00:00", lastdate_end: "2032-01-01T03:00:00+00:00" }),
        row({ uid: 6, location_coordinates: null }),
      ],
      "x",
      now,
    );
    expect(out.events).toHaveLength(1);
  });
  it("treats free entry and long runs", () => {
    const out = normalizeOpenAgenda([row({ conditions_fr: "Entrée libre", lastdate_end: "2027-01-10T18:00:00+00:00" })], "x", now);
    expect(out.events[0]).toMatchObject({ isFree: true, eventType: "multi_day" });
  });
});
