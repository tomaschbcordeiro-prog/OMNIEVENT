import { describe, it, expect } from "vitest";
import { isLiveNow } from "@/lib/store";
import { parseFilterParams, filtersToParams } from "@/lib/search/params";
import type { OmniEvent } from "@/lib/types";

const NOW = Date.parse("2026-10-27T20:30:00Z");
const ev = (patch: Partial<OmniEvent>): OmniEvent =>
  ({ id: "e", start: "2026-10-27T19:30:00Z", eventType: "single", status: "on_sale", timeZone: "Europe/Lisbon", ...patch }) as OmniEvent;

describe("live now", () => {
  it("counts a timed event that has started and not ended", () => {
    expect(isLiveNow(ev({}), NOW)).toBe(true);
    expect(isLiveNow(ev({ end: "2026-10-27T20:00:00Z" }), NOW)).toBe(false);
    expect(isLiveNow(ev({ start: "2026-10-27T21:00:00Z" }), NOW)).toBe(false);
  });
  it("assumes two hours without an end or a duration", () => {
    expect(isLiveNow(ev({ start: "2026-10-27T18:00:00Z" }), NOW)).toBe(false);
    expect(isLiveNow(ev({ start: "2026-10-27T18:00:00Z", durationMinutes: 180 }), NOW)).toBe(true);
  });
  it("leaves out all-day listings, long runs, daily attractions and cancelled events", () => {
    expect(isLiveNow(ev({ hoursUnknown: true }), NOW)).toBe(false);
    expect(isLiveNow(ev({ start: "2026-10-01T10:00:00Z", end: "2026-11-30T18:00:00Z", eventType: "multi_day" }), NOW)).toBe(false);
    expect(isLiveNow(ev({ eventType: "daily_attraction" }), NOW)).toBe(false);
    expect(isLiveNow(ev({ status: "cancelled" }), NOW)).toBe(false);
  });
  it("round-trips through URLs", () => {
    const p = filtersToParams({ live: true });
    expect(p.get("live")).toBe("1");
    const r = parseFilterParams(p);
    expect(r.ok && r.filters.live).toBe(true);
  });
});
