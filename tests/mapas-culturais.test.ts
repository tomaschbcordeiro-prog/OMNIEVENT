import { describe, expect, it } from "vitest";
import { MAPS, mapMapaCategory, normalizeMapas, type MapaOccurrence, type MapaSpace } from "@/lib/providers/mapas-culturais";
import sample from "./fixtures/mapas-culturais.json";

const now = Date.parse("2026-10-31T12:00:00Z");
const ce = MAPS.find((m) => m.id === "ce")!;
const space: MapaSpace = {
  id: 7,
  name: "Theatro José de Alencar",
  location: { latitude: "-3.7277", longitude: "-38.5292" },
  endereco: "Rua Liberato Barroso , 525, Centro, FORTALEZA, CE",
  En_Municipio: "FORTALEZA",
};
const spaces = new Map([[7, space]]);
const occ = (o: Partial<MapaOccurrence> = {}): MapaOccurrence => ({
  event_id: 1,
  name: "Espetáculo Borboletas",
  shortDescription: "Teatro para todas as idades.",
  terms: { linguagem: ["Teatro"] },
  singleUrl: "https://mapacultural.secult.ce.gov.br/evento/1/",
  starts_on: "2026-11-07",
  starts_at: "17:00:00",
  ends_on: null,
  ends_at: "18:00:00",
  rule: { startsOn: "2026-11-07", until: "2026-11-07", frequency: "once", price: "Gratuito" },
  space: { id: 7 },
  ...o,
});

describe("Mapas Culturais (Brazil)", () => {
  it("maps a real sample", () => {
    const out = normalizeMapas(ce, sample.rows as MapaOccurrence[], new Map((sample.spaces as MapaSpace[]).map((s) => [s.id, s])), "x", now);
    expect(out.events.length).toBeGreaterThan(5);
    for (const v of out.venues) expect(v).toMatchObject({ countryCode: "BR", timeZone: "America/Fortaleza" });
  });
  it("reads an event with its venue, local time and price", () => {
    const out = normalizeMapas(ce, [occ()], spaces, "x", now);
    // Fortaleza is UTC-3 all year.
    expect(out.events[0]).toMatchObject({ categorySlug: "plays", start: "2026-11-07T20:00:00.000Z", end: "2026-11-07T21:00:00.000Z", isFree: true, eventType: "single" });
    expect(out.venues[0]).toMatchObject({ name: "Theatro José de Alencar", city: "Fortaleza", cityId: "fortaleza", address: "Rua Liberato Barroso, 525, Centro, FORTALEZA, CE" });
  });
  it("joins the sessions of one event at one venue", () => {
    const out = normalizeMapas(ce, [occ(), occ({ starts_on: "2026-11-14" })], spaces, "x", now);
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({ eventType: "recurring", schedule: ["2026-11-14T20:00:00.000Z"] });
  });
  it("shows a long daily exhibition as one run", () => {
    const days = Array.from({ length: 20 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
    const rule = { startsOn: "2026-11-01", until: "2026-11-20", frequency: "daily" };
    const out = normalizeMapas(ce, days.map((d) => occ({ name: "Exposição Florescer", terms: { linguagem: ["Artes Visuais"] }, starts_on: d, rule })), spaces, "x", now);
    expect(out.events[0]).toMatchObject({ categorySlug: "art-exhibitions", eventType: "multi_day", start: "2026-11-01T20:00:00.000Z", end: "2026-11-20T21:00:00.000Z" });
  });
  it("leaves out standing listings, past sessions and unplaced venues", () => {
    const out = normalizeMapas(
      ce,
      [
        occ({ event_id: 2, rule: { startsOn: "2026-03-15", until: "2080-03-15", frequency: "daily" } }),
        occ({ event_id: 3, starts_on: "2026-10-20" }),
        occ({ event_id: 4, space: { id: 99 } }),
      ],
      new Map([...spaces, [99, { id: 99, name: "Nowhere", location: { latitude: "0", longitude: "0" } }]]),
      "x",
      now,
    );
    expect(out.events).toHaveLength(0);
  });
  it("records an advertised price in reais", () => {
    const out = normalizeMapas(ce, [occ({ rule: { price: "R$ 20,00 (inteira)" } })], spaces, "x", now);
    expect(out.events[0]).toMatchObject({ isFree: false, ticketAccess: "ticketed" });
    expect(out.offers[0]).toMatchObject({ basePrice: 20, currency: "BRL" });
  });
  it("picks categories from the title before the art forms", () => {
    expect(mapMapaCategory("Oficina Infantil de Pintura", ["Artes Visuais"])).toBe("family-shows");
    expect(mapMapaCategory("Concerto da Orquestra", ["Música"])).toBe("classical");
    expect(mapMapaCategory("Noite de Forró", ["Música Popular"])).toBe("concerts");
    expect(mapMapaCategory("Encontro", ["Cultura Digital"])).toBe("public-lectures");
  });
});
