import { describe, expect, it } from "vitest";
import { mapBolCategory, normalizeBol, parseBolListing, venueGeo, type BolEvent } from "@/lib/providers/bol";

const ev = (over: Partial<BolEvent> = {}): BolEvent => ({
  productID: "1_181738",
  name: "Quimera",
  url: "https://www.bol.pt/Comprar/Bilhetes/181738-quimera-teatro_viriato/",
  startDate: "2026-12-31T16:00:00.0000000",
  endDate: "2026-12-31T16:00:00.0000000",
  duration: "PT50M",
  location: {
    name: "Teatro Viriato",
    url: "https://www.bol.pt/Projecto/EntidadesAderentes/1389-teatro_viriato",
    geo: { latitude: "40.6608627", longitude: "-7.90838249" },
    address: { streetAddress: "Largo Mouzinho de Albuquerque", postalCode: "3500-160", addressLocality: "Viseu" },
  },
  offers: { availability: "https://schema.org/InStock", price: "8", priceCurrency: "EUR", url: "https://www.bol.pt/x" },
  bolCategory: 1,
  ...over,
});

describe("BOL", () => {
  it("reads JSON-LD events from a listing", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "Event", ...ev() })}</script><script type="application/ld+json">{"@type":"Organization"}</script><script type="application/ld+json">{broken</script>`;
    const list = parseBolListing(html, 2);
    expect(list).toHaveLength(1);
    expect(list[0].bolCategory).toBe(2);
  });

  it("fixes a missing minus sign and rejects coordinates outside Portugal", () => {
    expect(venueGeo({ geo: { latitude: "41.1574", longitude: "8.6368" } })).toEqual({ lat: 41.1574, lng: -8.6368 });
    expect(venueGeo({ geo: { latitude: "40.41", longitude: "-3.70" } })).toBeUndefined();
    expect(venueGeo({ url: "u", geo: { latitude: "0", longitude: "0" } }, { u: { lat: 38.7, lng: -9.1 } })).toEqual({ lat: 38.7, lng: -9.1 });
  });

  it("maps categories from the listing and the title", () => {
    expect(mapBolCategory({ name: "Fado ao vivo", bolCategory: 2 })).toBe("traditional");
    expect(mapBolCategory({ name: "Hugo Sousa: Aqui Entre Nós - stand-up", bolCategory: 1 })).toBe("stand-up");
    expect(mapBolCategory({ name: "O Feiticeiro de Oz", bolCategory: 3 })).toBe("family-shows");
    expect(mapBolCategory({ name: "10º Trail Costa Vicentina", bolCategory: 4 })).toBe("marathon");
    expect(mapBolCategory({ name: "Lambchop", bolCategory: 2 })).toBe("concerts");
  });

  it("normalises shows with local time, price and venue; skips admin items and unplaced venues", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    const out = normalizeBol(
      [
        ev(),
        ev({ productID: "1_2", name: "Atendimento Geral 2026" }),
        ev({ productID: "1_3", name: "Somewhere", location: { name: "Sala Virtual", url: "nowhere" } }),
        ev({ productID: "1_4", name: "Past", startDate: "2026-01-01T10:00:00", endDate: "2026-01-01T10:00:00" }),
        ev({ productID: "1_5", name: "Museu", startDate: "2026-11-01T00:00:00", endDate: "2026-12-31T00:00:00", offers: { price: "0" } }),
      ],
      "2026-10-25T12:00:00Z",
      now,
      {},
    );
    expect(out.skipped).toBe(1);
    expect(out.events.map((e) => e.title)).toEqual(["Quimera", "Museu"]);
    const [q, m] = out.events;
    expect(q.start).toBe("2026-12-31T16:00:00.000Z"); // winter: Lisbon = UTC
    expect(q.durationMinutes).toBe(50);
    expect(q.groupSlug).toBe("theatre");
    expect(out.offers[0]).toMatchObject({ provider: "BOL", basePrice: 8, currency: "EUR", availability: "available" });
    expect(m).toMatchObject({ eventType: "multi_day", isFree: true, hoursUnknown: true });
    expect(out.venues[0]).toMatchObject({ name: "Teatro Viriato", countryCode: "PT", timeZone: "Europe/Lisbon" });
  });
});
