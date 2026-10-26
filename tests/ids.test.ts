import { describe, expect, it } from "vitest";
import { keyOf } from "@/lib/providers/common";
import { normalizeOpenAgenda, type OaRow } from "@/lib/providers/openagenda";
import { normalizeMontreal, type MtlProps } from "@/lib/providers/montreal";

const now = Date.parse("2026-10-25T12:00:00Z");

describe("ids and slugs", () => {
  it("keyOf spreads keys", () => {
    const keys = new Set(Array.from({ length: 20000 }, (_, i) => keyOf(`Salle des fêtes|${i}`)));
    expect(keys.size).toBe(20000);
  });
  it("keeps same-named venues in different villages apart", () => {
    const rows: OaRow[] = Array.from({ length: 400 }, (_, i) => ({
      uid: i + 1,
      canonicalurl: `https://openagenda.com/x/events/e${i}`,
      title_fr: "Loto",
      firstdate_begin: "2026-11-14T19:30:00+00:00",
      firstdate_end: "2026-11-14T21:30:00+00:00",
      lastdate_end: "2026-11-14T21:30:00+00:00",
      location_coordinates: { lat: 45 + i / 100, lon: 2 + i / 100 },
      location_name: "Salle des fêtes",
      location_city: `Village ${i}`,
      location_countrycode: "FR",
    }));
    const out = normalizeOpenAgenda(rows, "x", now);
    expect(new Set(out.venues.map((v) => v.id)).size).toBe(400);
    expect(new Set(out.venues.map((v) => v.slug)).size).toBe(400);
  });
  it("keeps sessions of a repeated title apart", () => {
    const rows: MtlProps[] = Array.from({ length: 300 }, (_, i) => ({
      titre: "Heure du conte",
      url_fiche: `https://montreal.ca/evenements/heure-du-conte-${i}`,
      date_debut: "2026-11-14",
      date_fin: "2026-11-14",
      titre_adresse: "Bibliothèque",
      lat: 45.5,
      long: -73.6,
    }));
    const out = normalizeMontreal(rows, "x", now);
    expect(new Set(out.events.map((e) => e.id)).size).toBe(300);
    expect(new Set(out.events.map((e) => e.slug)).size).toBe(300);
  });
});
