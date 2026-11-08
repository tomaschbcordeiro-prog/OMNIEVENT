import { describe, expect, it } from "vitest";
import { trimBatch } from "@/lib/store";
import type { OmniEvent } from "@/lib/types";
import type { ProviderBatch } from "@/lib/providers/types";

const ev = (id: string, start: string, venueId: string, people: string[] = []) =>
  ({ id, start, venueId, participants: people.map((participantId) => ({ participantId, role: "headliner" })) }) as unknown as OmniEvent;

describe("trimBatch", () => {
  const batch = {
    events: [ev("c", "2027-06-01T20:00:00Z", "v3", ["p3"]), ev("a", "2026-11-10T20:00:00Z", "v1", ["p1"]), ev("b", "2026-12-01T20:00:00Z", "v2", ["p1", "p2"])],
    venues: [{ id: "v1" }, { id: "v2" }, { id: "v3" }],
    participants: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
    offers: [{ id: "o1", eventId: "a" }, { id: "o3", eventId: "c" }],
  } as unknown as ProviderBatch;

  it("leaves a source under its limit as it is", () => {
    expect(trimBatch(batch, 5)).toBe(batch);
  });
  it("keeps the soonest events and only what they use", () => {
    const t = trimBatch(batch, 2);
    expect(t.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(t.venues.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(t.participants.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(t.offers.map((o) => o.id)).toEqual(["o1"]);
  });
});
