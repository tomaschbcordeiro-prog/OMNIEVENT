import { describe, expect, it } from "vitest";
import { durationOf, nightsOf, parsePlan, planIcs, planSortKey } from "@/lib/trip-plans";

const days = ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05"];
const ctx = { days, defaultDay: "2026-12-01" };

describe("a plan from a line of text", () => {
  it("a flight: number, route, day and times", () => {
    expect(parsePlan("Flight TP1350 Lisbon to London 2 Dec 9:40-12:15", ctx)).toEqual({ kind: "flight", title: "Flight to London", day: "2026-12-02", time: "09:40", endTime: "12:15", from: "Lisbon", to: "London", ref: "TP 1350" });
    expect(parsePlan("BA 432 LHR → LIS dec 4 18:05", ctx)).toMatchObject({ kind: "flight", ref: "BA 432", from: "LHR", to: "LIS", day: "2026-12-04", time: "18:05" });
  });
  it("a meeting with a place and a weekday", () => {
    // 4 Dec 2026 is a Friday.
    expect(parsePlan("Meeting with João at Café Nicola fri 15h", ctx)).toEqual({ kind: "meeting", title: "Meeting with João", day: "2026-12-04", time: "15:00", place: "Café Nicola" });
  });
  it("a stay over several nights", () => {
    expect(parsePlan("Hotel Plaza 2-5 Dec", ctx)).toEqual({ kind: "stay", title: "Hotel Plaza", day: "2026-12-02", endDay: "2026-12-05" });
    expect(parsePlan("Airbnb in Alfama", { ...ctx, defaultDay: "2026-12-03" })).toMatchObject({ kind: "stay", day: "2026-12-03", endDay: "2026-12-04" });
  });
  it("meals, trains, notes; Portuguese too", () => {
    expect(parsePlan("dinner 20:30", ctx)).toEqual({ kind: "meal", title: "Dinner", day: "2026-12-01", time: "20:30" });
    expect(parsePlan("Train Edinburgh → Dublin day 4 8am", ctx)).toMatchObject({ kind: "train", title: "Train to Dublin", from: "Edinburgh", to: "Dublin", day: "2026-12-03", time: "08:00" });
    expect(parsePlan("Jantar com a Ana às 21h30 sexta", ctx)).toMatchObject({ kind: "meal", title: "Jantar com a Ana", day: "2026-12-04", time: "21:30" });
    expect(parsePlan("Voo Porto para Lisboa 3/12 7:15", ctx)).toMatchObject({ kind: "flight", from: "Porto", to: "Lisboa", day: "2026-12-03", time: "07:15" });
    expect(parsePlan("Pick up the keys", ctx)).toEqual({ kind: "activity", title: "Pick up the keys", day: "2026-12-01" });
    expect(parsePlan("Call mum", ctx)).toMatchObject({ kind: "meeting", title: "Call mum" });
  });
  it("a date in the year that puts it in the trip", () => {
    expect(parsePlan("Show 2 Jan", { days: ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"], defaultDay: "2026-12-30" }).day).toBe("2027-01-02");
  });
});

describe("plans in the agenda and the calendar", () => {
  it("lengths, order and calendar lines", () => {
    expect(durationOf({ day: "2026-12-02", time: "09:40", endTime: "12:15" })).toBe("2h 35m");
    expect(durationOf({ day: "2026-12-02", time: "23:10", endTime: "01:05" })).toBe("1h 55m");
    expect(nightsOf({ day: "2026-12-02", endDay: "2026-12-05" })).toBe(3);
    expect([planSortKey({ kind: "meal", time: "20:30" }), planSortKey({ kind: "stay" }), planSortKey({ kind: "note" })].sort()).toEqual(["0", "120:30", "2"]);
    const ics = planIcs({ id: "p1", kind: "flight", title: "Flight to London", day: "2026-12-02", time: "09:40", endTime: "12:15", from: "Lisbon", to: "London", ref: "TP 1350", createdAt: "" }, "t1", "20261111T000000Z").join("\n");
    expect(ics).toContain("DTSTART:20261202T094000");
    expect(ics).toContain("DTEND:20261202T121500");
    expect(ics).toContain("SUMMARY:Flight to London (TP 1350): Lisbon → London");
    const stay = planIcs({ id: "p2", kind: "stay", title: "Hotel Plaza", day: "2026-12-02", endDay: "2026-12-05", createdAt: "" }, "t1", "x").join("\n");
    expect(stay).toContain("DTSTART;VALUE=DATE:20261202");
    expect(stay).toContain("DTEND;VALUE=DATE:20261205");
  });
});

describe("places on the map", () => {
  it("sorts them into kinds and names them", async () => {
    const { poiGroup, poiLabel, planKindForPoi, classesOf } = await import("@/lib/pois");
    expect(poiGroup("restaurant")).toBe("food");
    expect(poiGroup("castle", "palace")).toBe("sights");
    expect(poiGroup("pharmacy")).toBe("service");
    expect(poiLabel("castle", "palace")).toBe("Palace");
    expect(poiLabel("place_of_worship")).toBe("Place of worship");
    expect(planKindForPoi(poiGroup("museum"))).toBe("visit");
    expect(planKindForPoi(poiGroup("lodging"))).toBe("stay");
    expect(classesOf(["food", "service"])).toContain("cafe");
  });
  it("a filter for some kinds of places", async () => {
    const { poiFilter } = await import("@/lib/map/style");
    const all = poiFilter() as unknown[];
    const culture = poiFilter(["culture"]) as unknown[];
    // Some kinds: one more condition, naming only theirs.
    expect(culture.length).toBe(all.length + 1);
    const last = JSON.stringify(culture[culture.length - 1]);
    expect(last).toContain("museum");
    expect(last).not.toContain("restaurant");
    // Services: everything the kinds don't name.
    expect(JSON.stringify((poiFilter(["service"]) as unknown[]).at(-1))).toMatch(/^\["!"/);
    // Bins and bollards never.
    expect(JSON.stringify(all)).toContain("waste_basket");
  });
});
