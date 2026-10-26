import { describe, expect, it } from "vitest";
import { bcnTime, mapBcnCategory, normalizeBarcelona, type BcnRow } from "@/lib/providers/barcelona";
import rows from "./fixtures/barcelona.json";

const now = Date.parse("2026-10-26T12:00:00Z");
const row = (o: Partial<BcnRow> = {}): BcnRow => ({
  register_id: "﻿99400025475",
  name: "Advent Coral a l'Alcaldia *NOU*",
  start_date: "2026-12-12T03:00:00",
  end_date: "2026-12-12T03:00:00",
  timetable: '<table><tr><td class="timetable-hour"><div>a les 18.00&nbsp;h</div></td><td class="timetable-price"><div>Entrada: 8 €</div></td></tr></table>',
  addresses_road_name: "C Creu Coberta",
  addresses_start_street_number: 104,
  addresses_neighborhood_name: "Hostafrancs",
  addresses_zip_code: 8014,
  geo_epgs_4326_lat: "41.3754",
  geo_epgs_4326_lon: "2.1423",
  ...o,
});

describe("Barcelona agenda", () => {
  it("maps a real sample", () => {
    const out = normalizeBarcelona(rows as BcnRow[], "x", now);
    expect(out.events.length).toBeGreaterThan(20);
    for (const e of out.events) expect(e.officialUrl).toMatch(/^https:\/\/guia\.barcelona\.cat\/ca\/detall\/.+_\d+\.html$/);
  });
  it("reads the time, price, address and link", () => {
    const out = normalizeBarcelona([row()], "x", now);
    expect(out.events[0]).toMatchObject({ title: "Advent Coral a l'Alcaldia", start: "2026-12-12T17:00:00.000Z", eventType: "single", ticketAccess: "ticketed" });
    expect(out.events[0].officialUrl).toBe("https://guia.barcelona.cat/ca/detall/advent-coral-a-l-alcaldia_99400025475.html");
    expect(out.venues[0]).toMatchObject({ name: "C Creu Coberta, 104", city: "Barcelona", address: "C Creu Coberta, 104, Hostafrancs, 08014 Barcelona" });
    expect(out.offers[0]).toMatchObject({ basePrice: 8, currency: "EUR" });
  });
  it("skips past, undated, unplaced, league football and duplicates", () => {
    const out = normalizeBarcelona(
      [
        row(),
        row(),
        row({ register_id: "2", end_date: "2026-01-01T03:00:00", start_date: "2026-01-01T03:00:00" }),
        row({ register_id: "3", start_date: null }),
        row({ register_id: "4", geo_epgs_4326_lat: null }),
        row({ register_id: "5", name: "Futbol 'F.C. Barcelona - R.C. Deportivo' Partit de Lliga" }),
      ],
      "x",
      now,
    );
    expect(out.events).toHaveLength(1);
  });
  it("treats free entry and runs of several days", () => {
    const out = normalizeBarcelona([row({ end_date: "2027-01-20T03:00:00", timetable: '<td class="timetable-price"><div>Entrada Gratuïta</div></td>' })], "x", now);
    expect(out.events[0]).toMatchObject({ isFree: true, eventType: "multi_day", hoursUnknown: true });
  });
  it("only trusts a single start time", () => {
    expect(bcnTime("<div>a les 22.00&nbsp;h</div>")).toBe("22:00");
    expect(bcnTime("<div>de 18.00 h a 21.00 h</div>")).toBeUndefined();
    expect(bcnTime("<div>a les 11.00 h</div><div>a les 17.00 h</div>")).toBeUndefined();
  });
  it("maps categories from the title", () => {
    expect(mapBcnCategory("Taller 'Ioga'")).toBe("creative-workshops");
    expect(mapBcnCategory("Exposició 'Nine waves'")).toBe("art-exhibitions");
    expect(mapBcnCategory("Concert \"Cano\"")).toBe("concerts");
    expect(mapBcnCategory("Espectacle infantil 'Contes'")).toBe("family-shows");
    expect(mapBcnCategory("46a Cursa Popular de Sant Martí")).toBe("sports");
  });
});
