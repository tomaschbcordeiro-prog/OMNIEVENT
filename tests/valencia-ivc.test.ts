import { describe, expect, it } from "vitest";
import { groupIvc, ivcTime, mapIvcCategory, normalizeIvc, type IvcRow } from "@/lib/providers/valencia-ivc";
import flat from "./fixtures/valencia-ivc.json";

const now = Date.parse("2026-10-26T12:00:00Z");
const row = (o: Partial<IvcRow> = {}): IvcRow => ({
  titulo_evento: "A FIDAI FILM",
  tipo_evento: "pelicula",
  fecha_inicio: "29/10/2026",
  fecha_fin: "29/10/2026",
  hora: "18:00",
  municipio: "València",
  lugar_evento: "Edificio Rialto",
  direccion: "Plaça de l'Ajuntament, 17",
  precio: "3 €",
  latitud: "39.471",
  longitud: "-0.37631",
  web: "https://ivc.gva.es/es/audiovisuales/pelicula-14468/a-fidai-film",
  ...o,
});

describe("Institut Valencià de Cultura", () => {
  it("regroups the flat feed", () => {
    const rows = groupIvc([{ titulo_evento: "A" }, { hora: "18:00" }, { titulo_evento: "B" }, { latitud: "39.4" }]);
    expect(rows).toEqual([{ titulo_evento: "A", hora: "18:00" }, { titulo_evento: "B", latitud: "39.4" }]);
    expect(groupIvc(flat as unknown as Record<string, unknown>[]).length).toBeGreaterThan(20);
  });
  it("joins sessions of a title at a venue", () => {
    const out = normalizeIvc([row(), row({ fecha_inicio: "30/10/2026", fecha_fin: "30/10/2026", hora: "20:30" })], "x", now);
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({ categorySlug: "cinema", eventType: "recurring", start: "2026-10-29T17:00:00.000Z", schedule: ["2026-10-30T19:30:00.000Z"] });
    expect(out.offers[0]).toMatchObject({ basePrice: 3, currency: "EUR" });
    expect(out.venues[0]).toMatchObject({ name: "Edificio Rialto", city: "València" });
  });
  it("skips cancelled, past and unplaced", () => {
    const out = normalizeIvc([row({ titulo_evento: "(CANCELADO) ORQUESTRA" }), row({ fecha_inicio: "12/01/2025", fecha_fin: "12/01/2025" }), row({ latitud: "" })], "x", now);
    expect(out.events).toHaveLength(0);
  });
  it("reads only a single time", () => {
    expect(ivcTime(", D - 18 h")).toBe("18:00");
    expect(ivcTime("20.30 h")).toBe("20:30");
    expect(ivcTime("10 a 14 h")).toBeUndefined();
    expect(ivcTime("X, 18 h y 20 h")).toBeUndefined();
  });
  it("maps categories", () => {
    expect(mapIvcCategory("Artes escénicas")).toBe("plays");
    expect(mapIvcCategory("Música")).toBe("concerts");
  });
});
