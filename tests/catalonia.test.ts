import { describe, expect, it } from "vitest";
import { catStartTime, mapCatCategory, normalizeCatalonia, type CatRow } from "@/lib/providers/catalonia";
import ROWS from "./fixtures/catalonia.json";

describe("Catalonia agenda", () => {
  it("reads start times and categories", () => {
    expect(catStartTime("18 h Durada aproximada: 50 minuts.")).toBe("18:00");
    expect(catStartTime("17.30 h")).toBe("17:30");
    expect(catStartTime("A les 19 h")).toBe("19:00");
    expect(catStartTime("De dimarts a diumenges: de 10 a 17 h")).toBeUndefined();
    expect(mapCatCategory("agenda:categories/infantil,agenda:categories/teatre")).toBe("family-shows");
    expect(mapCatCategory("agenda:categories/exposicions")).toBe("art-exhibitions");
    expect(mapCatCategory("")).toBe("culture");
  });

  it("normalises real rows", () => {
    const now = Date.parse("2026-10-25T08:00:00Z");
    const out = normalizeCatalonia(ROWS as CatRow[], "2026-10-25T08:00:00Z", now);
    expect(out.events.length).toBeGreaterThan(0);
    const conhort = out.events.find((e) => e.title === "Conhort")!;
    expect(conhort.start).toBe("2026-10-25T17:00:00.000Z"); // 18:00 CET (summer time ended that morning)
    expect(conhort.categorySlug).toBe("circus");
    const v = out.venues.find((x) => x.id === conhort.venueId)!;
    expect(v).toMatchObject({ name: "Roca Umbert Fàbrica de les Arts", city: "Granollers", countryCode: "ES" });
    expect(out.offers.find((o) => o.eventId === conhort.id)).toMatchObject({ basePrice: 15, currency: "EUR" });
  });
});
