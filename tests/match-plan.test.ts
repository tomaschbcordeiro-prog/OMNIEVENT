import { describe, it, expect } from "vitest";
import { parseInput, planToFilters, planFromParams, planToParams, planSentence, suggest, EMPTY_PLAN } from "@/lib/match/plan";

const NOW = new Date("2026-10-27T15:00:00Z"); // a Tuesday

describe("Match plan", () => {
  it("turns typing into chips: places, vibes, keywords", () => {
    const p = parseInput("Lisboa, Madrid e jazz", "Europe/Lisbon", NOW);
    expect(p.places.map((x) => x.id)).toEqual(["lisbon", "madrid"]);
    expect(p.what.map((x) => x.cat ?? x.text)).toEqual(["jazz"]);
    expect(parseInput("coldplay", "UTC", NOW).what).toEqual([{ text: "coldplay", label: "coldplay" }]);
    expect(parseInput("teatro", "UTC", NOW).what[0].cat).toBe("theatre");
    expect(parseInput("jazz em lisboa", "UTC", NOW)).toMatchObject({ places: [{ id: "lisbon" }], what: [{ cat: "jazz" }] });
    expect(parseInput("portugal", "UTC", NOW).places[0].id).toBe("pt");
  });
  it("understands when, free and prices", () => {
    expect(parseInput("fim de semana", "UTC", NOW).when).toBe("weekend");
    expect(parseInput("tomorrow", "UTC", NOW).when).toBe("tomorrow");
    expect(parseInput("grátis", "UTC", NOW).free).toBe(true);
    expect(parseInput("under 20€", "UTC", NOW).maxPrice).toEqual({ amount: 20, currency: "EUR" });
  });
  it("builds the search: places or places, keywords or keywords", () => {
    const plan = { ...EMPTY_PLAN, places: [{ id: "lisbon", label: "Lisbon" }, { id: "madrid", label: "Madrid" }], what: [{ text: "jazz", label: "Jazz", cat: "jazz" }, { text: "fado", label: "fado" }], when: "weekend" as const };
    const f = planToFilters(plan, NOW);
    expect(f).toMatchObject({ places: ["lisbon", "madrid"], anyOf: ["jazz", "fado"], from: "2026-10-30", to: "2026-11-01" });
    expect(planSentence(plan)).toBe("Jazz or fado in Lisbon or Madrid, this weekend");
    expect(planFromParams(planToParams(plan))).toMatchObject({ places: plan.places, what: plan.what, when: "weekend" });
  });
  it("suggests places and vibes as you type", () => {
    expect(suggest("lis").places[0].id).toBe("lisbon");
    expect(suggest("jaz").cats[0].cat).toBe("jazz");
    expect(suggest("tea").cats.some((c) => c.cat === "theatre")).toBe(true);
  });
});
