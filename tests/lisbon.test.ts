import { describe, it, expect } from "vitest";
import { normalizeLisbon, parseTimes, parsePrices, mapLisbonCategory, sameVenueName, type AlxEvent } from "@/lib/providers/lisbon";
import { sellerSearches, searchTerms } from "@/lib/sellers";

// Hand-written fixtures in the shape of the agendalx.pt v1 API (not real data).
const NOW = Date.parse("2026-10-24T10:00:00Z");
const VENUES = { "teatro-x": { name: "Teatro X", lat: 38.71, lng: -9.14 } };
const base: AlxEvent = {
  id: 1,
  title: { rendered: "Concerto &#8211; Fixture" },
  venue: { "teatro-x": { id: 1, slug: "teatro-x", name: "Teatro X" } },
  categories_name_list: { musica: { slug: "musica", name: "música" } },
  subject: "jazz",
  link: "https://www.agendalx.pt/events/event/fixture/",
  occurences: ["2026-10-01", "2026-10-30", "2026-10-31"],
  string_times: "sex: 21h; sáb: 18h30",
  price_cat: "value",
  price_val: 'a:2:{i:0;a:2:{s:5:"value";s:2:"10";s:11:"description";s:6:"adulto";}i:1;a:2:{s:5:"value";s:1:"8";s:11:"description";s:8:"criança";}}',
};

describe("lisbon agenda adapter", () => {
  it("parses weekday times and price lists", () => {
    expect(parseTimes("sex: 21h; sáb: 18h30")).toEqual({ byDay: { 5: ["21:00"], 6: ["18:30"] } });
    expect(parseTimes("21h00")).toEqual({ all: ["21:00"] });
    expect(parseTimes("seg a qua: 19h")?.byDay).toEqual({ 1: ["19:00"], 2: ["19:00"], 3: ["19:00"] });
    expect(parseTimes("sáb e dom: 16h")?.byDay).toEqual({ 6: ["16:00"], 0: ["16:00"] });
    expect(parseTimes("vários horários")).toBeNull();
    expect(parsePrices(base.price_val)).toEqual({ amounts: [10, 8], notes: ["adulto", "criança"] });
    expect(mapLisbonCategory({ subject: "visitas guiadas", categories_name_list: { "visitas-guiadas": {} } })).toBe("guided-tours");
  });
  it("builds sessions from dates and weekday times in Lisbon time", () => {
    const b = normalizeLisbon([base], "2026-10-24T10:00:00Z", VENUES, NOW);
    const e = b.events[0];
    expect(e.title).toBe("Concerto – Fixture");
    expect(e.start).toBe("2026-10-30T21:00:00.000Z"); // Friday, WET (UTC+0) after the clocks change
    expect(e.schedule).toEqual(["2026-10-31T18:30:00.000Z"]);
    expect(e.eventType).toBe("recurring");
    expect(e.categorySlug).toBe("jazz");
    expect(b.venues[0]).toMatchObject({ countryCode: "PT", cityId: "lisbon", lat: 38.71 });
    expect(b.offers[0]).toMatchObject({ basePrice: 8, maxPrice: 10, currency: "EUR", providerType: "organizer" });
    expect(b.offers[0].feesIncluded).toBeUndefined();
  });
  it("lists date-only events without inventing times, and skips venues it can't place", () => {
    const b = normalizeLisbon([
      { ...base, id: 2, string_times: "vários horários", occurences: ["2026-11-05", "2026-11-12"] },
      { ...base, id: 3, venue: { unknown: { name: "Somewhere" } } },
      { ...base, id: 4, venue: false },
      { ...base, id: 5, occurences: [], StartDate: "2026-09-01", LastDate: "2026-12-31", string_times: "", price_cat: "free", price_val: "" },
    ], "2026-10-24T10:00:00Z", VENUES, NOW);
    expect(b.unplaced).toBe(2);
    const [dates, run] = b.events;
    expect(dates.hoursUnknown).toBe(true);
    expect(dates.schedule).toHaveLength(1);
    expect(run.eventType).toBe("multi_day");
    expect(run.isFree).toBe(true);
    expect(run.start).toBe("2026-10-23T23:00:00.000Z"); // today, midnight in Lisbon (WEST)
  });
  it("only accepts map matches whose names clearly agree", () => {
    expect(sameVenueName("Teatro Nacional D. Maria II", "Teatro Nacional Dona Maria II")).toBe(true);
    expect(sameVenueName("Galeria Ratton", "Galeria IMAGO LISBOA")).toBe(false);
    expect(sameVenueName("Sagres Campo Pequeno", "Farmácia Sagres")).toBe(false);
    expect(sameVenueName("MAAT - Museu de Arte, Arquitetura e Tecnologia", "Museu de Arte, Arquitetura e Tecnologia (MAAT)")).toBe(true);
  });
});

describe("ticket seller comparison links", () => {
  it("offers Portuguese sellers' searches, skipping sellers already listed", () => {
    const s = sellerSearches("PT", "Concerto: Fixture «Live» no Coliseu dos Recreios em Lisboa", "Lisbon", ["Ticketline"]);
    expect(s.map((x) => x.name)).toEqual(["BOL", "MEO Blueticket", "Eventbrite"]);
    expect(s[0].url).toBe("https://www.bol.pt/Comprar/Pesquisa?q=Concerto%20Fixture%20Live%20no%20Coliseu%20dos");
    expect(searchTerms("A — B")).toBe("A B");
    expect(searchTerms("Heathers, o musical")).toBe("Heathers o musical");
    expect(s[2].url).toBe("https://www.eventbrite.pt/d/portugal--lisboa/Concerto%20Fixture%20Live%20no%20Coliseu%20dos/");
    expect(sellerSearches("ZZ", "x", "y")).toEqual([]);
  });
});

describe("lisbon snapshot", () => {
  it("is valid and maps most events onto the map", async () => {
    const snap = (await import("@/lib/providers/data/lisbon-events.json")).default as unknown as { fetchedAt: string; events: AlxEvent[] };
    expect(Date.parse(snap.fetchedAt)).toBeGreaterThan(0);
    const b = normalizeLisbon(snap.events, snap.fetchedAt, undefined, Date.parse(snap.fetchedAt));
    expect(b.events.length).toBeGreaterThan(snap.events.length * 0.6);
  });
});
