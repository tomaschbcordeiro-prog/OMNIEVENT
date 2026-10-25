import { describe, expect, it } from "vitest";
import { normalizeCyl, type CylRow } from "@/lib/providers/castilla-leon";
import ROWS from "./fixtures/castilla-leon.json";

describe("Castilla y León agenda", () => {
  const out = normalizeCyl(ROWS as CylRow[], "2026-10-25T08:00:00Z", Date.parse("2026-10-25T08:00:00Z"));
  const find = (t: string) => out.events.find((e) => e.title.includes(t))!;
  it("places village library events with their address", () => {
    const e = find("Un mundo de cuentos");
    expect(e.title).toBe("Un mundo de cuentos");
    expect(e.categorySlug).toBe("family-shows");
    expect(e.start).toBe("2026-11-13T09:00:00.000Z"); // 10:00 CET
    const v = out.venues.find((x) => x.id === e.venueId)!;
    expect(v).toMatchObject({ name: "Biblioteca Pública Municipal de Covaleda", city: "Covaleda", countryCode: "ES" });
  });
  it("reads prices and exhibition periods", () => {
    const c = find("A Cappella Christmas");
    expect(out.offers.find((o) => o.eventId === c.id)).toMatchObject({ basePrice: 10, currency: "EUR" });
    const x = find("8 Mujeres");
    expect(x).toMatchObject({ eventType: "multi_day", isFree: true, hoursUnknown: true });
  });
});
