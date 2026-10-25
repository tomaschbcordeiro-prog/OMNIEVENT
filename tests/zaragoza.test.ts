import { describe, expect, it } from "vitest";
import { normalizeZaragoza, type ZgzEvent } from "@/lib/providers/zaragoza";
import ROWS from "./fixtures/zaragoza.json";

describe("Zaragoza agenda", () => {
  const out = normalizeZaragoza(ROWS as unknown as ZgzEvent[], "x", Date.parse("2026-10-25T06:00:00Z"));
  it("reads time, price and venue", () => {
    const v = out.events.find((e) => e.title.startsWith("Visita comentada"))!;
    expect(v.start).toBe("2026-10-25T11:00:00.000Z"); // 12:00 CET
    expect(v.categorySlug).toBe("guided-tours");
    expect(out.offers.find((o) => o.eventId === v.id)).toMatchObject({ basePrice: 2, currency: "EUR" });
    expect(out.venues.find((x) => x.id === v.venueId)).toMatchObject({ name: "Museo del Puerto Fluvial de Caesaraugusta", countryCode: "ES" });
  });
  it("marks free events", () => {
    expect(out.events.find((e) => e.title.startsWith("Escape Room"))).toMatchObject({ isFree: true });
  });
});
