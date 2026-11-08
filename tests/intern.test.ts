import { describe, expect, it } from "vitest";
import { internBatch } from "@/lib/intern";
import type { ProviderBatch } from "@/lib/providers/types";

const url = (i: number) => `https://tickets.example/event/${i}`;
const batch = () =>
  JSON.parse(
    JSON.stringify({
      events: [0, 1].map((i) => ({ id: `e-${i}`, slug: `show-${i}`, title: "The Same Tour", description: "A long description shared by every date of the tour.", officialUrl: url(i), venueId: "venue-1", schedule: ["2026-12-01T20:00:00.000Z"], participants: [{ participantId: "artist-1", role: "headliner" }], provenance: { provider: "tm", externalId: `x${i}`, sourceUrl: url(i), lastSyncedAt: "2026-11-08T20:00:00.000Z" } })),
      venues: [{ id: "venue-1", name: "Hall", provenance: { lastSyncedAt: "2026-11-08T20:00:00.000Z" } }],
      participants: [],
      offers: [0, 1].map((i) => ({ id: `o-${i}`, eventId: `e-${i}`, purchaseUrl: url(i) })),
    }),
  ) as ProviderBatch;

describe("internBatch", () => {
  it("changes no value", () => {
    expect(internBatch(batch())).toEqual(batch());
  });

  it("keeps one copy of repeated texts", () => {
    // Equal strings can't be told apart by identity in JavaScript; check the values stay
    // equal and that lists and nested records are walked without being replaced.
    const b = batch();
    const events = b.events;
    const people = b.events[0].participants;
    internBatch(b);
    expect(b.events).toBe(events);
    expect(b.events[0].participants).toBe(people);
    expect(b.events[0].provenance.sourceUrl).toBe(b.events[0].officialUrl);
    expect(b.offers[1].purchaseUrl).toBe(b.events[1].officialUrl);
  });

  it("copes with missing lists", () => {
    expect(() => internBatch({ events: [], venues: [], participants: [], offers: undefined } as unknown as ProviderBatch)).not.toThrow();
  });
});
