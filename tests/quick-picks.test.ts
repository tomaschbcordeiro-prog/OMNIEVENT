import { describe, expect, it } from "vitest";
import { activeQuick, quickPicks, toggleQuick } from "@/lib/search/quick";

// A Wednesday, a Saturday and a Sunday, at noon on the visitor's clock.
const wed = new Date(2026, 10, 11, 12);
const sat = new Date(2026, 10, 14, 12);
const sun = new Date(2026, 10, 15, 12);

describe("quick picks", () => {
  it("cover today, tonight, tomorrow, the weekend, the next week and free", () => {
    expect(quickPicks(wed).map((p) => p.id)).toEqual(["today", "tonight", "tomorrow", "weekend", "week", "free"]);
    const f = toggleQuick({}, "weekend", wed);
    expect([f.from, f.to]).toEqual(["2026-11-13", "2026-11-15"]);
    expect(toggleQuick({}, "tomorrow", wed)).toMatchObject({ from: "2026-11-12", to: "2026-11-12" });
    expect(toggleQuick({}, "week", wed)).toMatchObject({ from: "2026-11-11", to: "2026-11-17" });
  });

  it("take what's left of the weekend on a Saturday or a Sunday", () => {
    expect(toggleQuick({}, "weekend", sat)).toMatchObject({ from: "2026-11-14", to: "2026-11-15" });
    expect(toggleQuick({}, "weekend", sun)).toMatchObject({ from: "2026-11-15", to: "2026-11-15" });
  });

  it("tonight is today from six in the evening, and reads apart from today", () => {
    const f = toggleQuick({}, "tonight", wed);
    expect(f).toMatchObject({ from: "2026-11-11", to: "2026-11-11", tFrom: "18:00", tTo: "04:00" });
    expect([...activeQuick(f, wed)]).toEqual(["tonight"]);
    expect([...activeQuick(toggleQuick({}, "today", wed), wed)]).toEqual(["today"]);
  });

  it("replace one another, and switch off when tapped again", () => {
    let f = toggleQuick({ q: "jazz", city: "lisbon" }, "tonight", wed);
    f = toggleQuick(f, "tomorrow", wed);
    expect(f).toMatchObject({ q: "jazz", city: "lisbon", from: "2026-11-12", to: "2026-11-12" });
    expect(f.tFrom).toBeUndefined();
    f = toggleQuick(f, "tomorrow", wed);
    expect(f.from).toBeUndefined();
    expect(f.to).toBeUndefined();
    expect(f).toMatchObject({ q: "jazz", city: "lisbon" });
  });

  it("keep a time window the visitor chose themselves", () => {
    const f = toggleQuick({ tFrom: "09:00", tTo: "12:00" }, "week", wed);
    expect(f).toMatchObject({ tFrom: "09:00", tTo: "12:00" });
    expect(activeQuick(f, wed).has("week")).toBe(false);
  });

  it("free goes on and off by itself, beside a date", () => {
    let f = toggleQuick(toggleQuick({}, "today", wed), "free", wed);
    expect([...activeQuick(f, wed)].sort()).toEqual(["free", "today"]);
    f = toggleQuick(f, "free", wed);
    expect(f.access).toBeUndefined();
    expect(f.from).toBe("2026-11-11");
  });

  it("start again from the first page", () => {
    expect(toggleQuick({ page: 3 }, "free", wed).page).toBeUndefined();
    expect(toggleQuick({ page: 3 }, "today", wed).page).toBeUndefined();
  });
});
