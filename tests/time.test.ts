import { describe, it, expect } from "vitest";
import { zonedToUtc, windowIntervals, overlaps, tzLabel, tzOffsetMs } from "@/lib/time";

const iso = (t: number) => new Date(t).toISOString();

describe("time-zone-aware windows", () => {
  it("converts Lisbon summer and winter wall time correctly", () => {
    expect(iso(zonedToUtc(2026, 10, 24, 18, 0, "Europe/Lisbon"))).toBe("2026-10-24T17:00:00.000Z"); // WEST (UTC+1)
    expect(iso(zonedToUtc(2026, 10, 26, 18, 0, "Europe/Lisbon"))).toBe("2026-10-26T18:00:00.000Z"); // WET (UTC+0)
    expect(iso(zonedToUtc(2026, 10, 24, 18, 0, "America/New_York"))).toBe("2026-10-24T22:00:00.000Z");
    expect(iso(zonedToUtc(2026, 10, 24, 18, 0, "Asia/Tokyo"))).toBe("2026-10-24T09:00:00.000Z");
  });
  it("ambiguous hour (clocks back, Lisbon 25 Oct 2026 01:30): earliest for starts, latest for ends", () => {
    expect(iso(zonedToUtc(2026, 10, 25, 1, 30, "Europe/Lisbon", "earliest"))).toBe("2026-10-25T00:30:00.000Z");
    expect(iso(zonedToUtc(2026, 10, 25, 1, 30, "Europe/Lisbon", "latest"))).toBe("2026-10-25T01:30:00.000Z");
  });
  it("nonexistent hour (clocks forward, New York 8 Mar 2026 02:30) moves after the gap", () => {
    expect(iso(zonedToUtc(2026, 3, 8, 2, 30, "America/New_York"))).toBe("2026-03-08T07:30:00.000Z"); // = 03:30 EDT
  });
  it("evening window 18:00–23:00 in Lisbon", () => {
    const [w] = windowIntervals("2026-10-24", "2026-10-24", "Europe/Lisbon", "18:00", "23:00");
    expect([iso(w[0]), iso(w[1])]).toEqual(["2026-10-24T17:00:00.000Z", "2026-10-24T22:00:00.000Z"]);
  });
  it("an event 22:00–01:00 overlaps an 18:00–23:00 window", () => {
    const [w] = windowIntervals("2026-11-02", "2026-11-02", "Europe/Lisbon", "18:00", "23:00");
    const ev: [number, number] = [Date.parse("2026-11-02T22:00:00Z"), Date.parse("2026-11-03T01:00:00Z")];
    expect(overlaps(w, ev)).toBe(true);
  });
  it("overnight window 22:00–04:00 runs into the next day", () => {
    const [w] = windowIntervals("2026-11-02", "2026-11-02", "Europe/Lisbon", "22:00", "04:00");
    expect([iso(w[0]), iso(w[1])]).toEqual(["2026-11-02T22:00:00.000Z", "2026-11-03T04:00:00.000Z"]);
  });
  it("whole-day windows on the 25-hour day are 25 hours long", () => {
    const [w] = windowIntervals("2026-10-25", "2026-10-25", "Europe/Lisbon");
    expect((w[1] - w[0]) / 3600000).toBe(25);
  });
  it("a date range yields one window per day", () => {
    expect(windowIntervals("2026-10-24", "2026-10-26", "Asia/Tokyo", "10:00", "12:00")).toHaveLength(3);
  });
  it("labels the zone with its current abbreviation and offset", () => {
    expect(tzLabel("Europe/Lisbon", new Date("2026-10-24T12:00:00Z"))).toBe("WEST, UTC+01:00");
    expect(tzLabel("Asia/Tokyo", new Date("2026-10-24T12:00:00Z"))).toBe("UTC+09:00");
    expect(tzOffsetMs(Date.parse("2026-01-10T12:00:00Z"), "America/New_York")).toBe(-5 * 3600000);
  });
});
