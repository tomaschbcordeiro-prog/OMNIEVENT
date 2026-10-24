import { describe, it, expect } from "vitest";
import { normalizeTribe, SOURCES, mapTribeCategory, type TribeEvent } from "@/lib/providers/venue-calendars";
import { normalizeFootball, groundFor, type FdMatch } from "@/lib/providers/football";
import { normalizeLisbon } from "@/lib/providers/lisbon";

// Hand-written fixtures in each source's response shape (not real data).
const NOW = Date.parse("2026-10-24T10:00:00Z");
const SYNC = "2026-10-24T10:00:00Z";

describe("venue calendars (The Events Calendar API)", () => {
  const ev = (id: number, date: string, utc: string, cats: string[], extra: Partial<TribeEvent> = {}): TribeEvent => ({
    id, title: "Show &#8220;X&#8221;", url: `https://www.ccb.pt/evento/show-x/${date}/`, utc_start_date: utc, utc_end_date: utc.replace(/ (\d\d)/, (_, h) => ` ${String(Number(h) + 2).padStart(2, "0")}`), categories: cats.map((slug) => ({ slug })), ...extra,
  });
  const raw = [
    ev(1, "2026-11-01", "2026-11-01 20:00:00", ["musica", "jazz"], { cost_details: { values: ["15", "25"] } }),
    ev(2, "2026-11-02", "2026-11-02 20:00:00", ["musica", "jazz"]),
    { ...ev(3, "2026-11-03", "2026-11-03 09:00:00", ["escolas"]), url: "https://www.ccb.pt/evento/visita-escolas/2026-11-03/" },
    { ...ev(4, "2026-10-01", "2026-10-01 20:00:00", ["teatro"]), url: "https://www.ccb.pt/evento/past/2026-10-01/" },
  ];
  const b = normalizeTribe(SOURCES[0], raw, SYNC, NOW);
  it("groups sessions of one show, skips school-only and past sessions", () => {
    expect(b.events).toHaveLength(1);
    const e = b.events[0];
    expect(e.title).toBe("Show “X”");
    expect(e.eventType).toBe("recurring");
    expect(e.start).toBe("2026-11-01T20:00:00.000Z");
    expect(e.schedule).toEqual(["2026-11-02T20:00:00.000Z"]);
    expect(e.durationMinutes).toBe(120);
    expect(e.categorySlug).toBe("jazz");
    expect(b.venues[0]).toMatchObject({ name: "Centro Cultural de Belém", countryCode: "PT", cityId: "lisbon" });
    expect(b.offers[0]).toMatchObject({ basePrice: 15, maxPrice: 25, currency: "EUR", providerType: "box_office" });
    expect(mapTribeCategory(["familias", "atividades"])).toBe("family-shows");
  });
});

describe("football fixtures", () => {
  const m = (id: number, home: string, away: string, status = "TIMED"): FdMatch => ({ id, utcDate: "2026-11-08T20:30:00Z", status, matchday: 10, stage: "REGULAR_SEASON", competition: { code: "PPL", name: "Primeira Liga" }, homeTeam: { id: id * 10, name: home }, awayTeam: { id: id * 10 + 1, name: away } });
  it("places matches at the home ground and skips unknown grounds", () => {
    const b = normalizeFootball([m(1, "Sport Lisboa e Benfica", "FC Porto"), m(2, "Sporting Clube de Braga", "Sporting Clube de Portugal", "SCHEDULED"), m(3, "Unknown FC", "Benfica")], SYNC);
    expect(b.events.map((e) => e.title)).toEqual(["Sport Lisboa e Benfica vs FC Porto", "Sporting Clube de Braga vs Sporting Clube de Portugal"]);
    expect(b.venues.map((v) => v.name)).toEqual(["Estádio da Luz", "Estádio Municipal de Braga"]);
    expect(b.events[0].sports).toMatchObject({ competition: "Primeira Liga", stage: "Matchday 10" });
    expect(b.events[0].participants.map((p) => p.role)).toEqual(["team_home", "team_away"]);
    expect(b.events[1].statusNote).toMatch(/to be confirmed/);
    expect(groundFor("Sporting Clube de Portugal")?.name).toBe("Estádio José Alvalade");
    expect(groundFor("Vitória SC")?.city).toBe("Guimarães");
  });
});

describe("lisbon venue matching", () => {
  it("finds a known venue by name when the agenda changes its slug", () => {
    const b = normalizeLisbon([{ id: 9, title: { rendered: "Peça" }, venue: { "novo-slug": { name: "Teatro X" } }, occurences: ["2026-11-02"], string_times: "21h00" }], SYNC, { "teatro-x": { name: "Teatro X", lat: 38.7, lng: -9.1 } }, NOW);
    expect(b.events).toHaveLength(1);
    expect(b.unplaced).toBe(0);
  });
});
