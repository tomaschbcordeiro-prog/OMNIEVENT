import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { packBatch, unpack } from "@/lib/shared-cache";
import type { ProviderBatch } from "@/lib/providers/types";

const batch = (n: number): ProviderBatch =>
  ({
    events: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, title: `Concert ${i} — “quoted” ünïcode 🎵`, description: "The same long tour text, repeated on every date. ".repeat(8), start: "2026-12-01T20:00:00Z", isFree: i % 2 === 0, tags: i % 3 ? ["a", "b"] : undefined })),
    venues: [{ id: "v1", name: "Hall" }],
    participants: [],
    offers: Array.from({ length: 3 }, (_, i) => ({ id: `o${i}`, eventId: `e${i}` })),
  }) as unknown as ProviderBatch;

describe("shared copies", () => {
  it("pack in slices and unpack to the same data", async () => {
    const b = batch(4500);
    const packed = await packBatch(b);
    expect(JSON.parse(unpack(packed, "br").toString("utf8"))).toEqual(JSON.parse(JSON.stringify(b)));
    // Far smaller than gzip for repeated text.
    expect(packed.length).toBeLessThan(gzipSync(Buffer.from(JSON.stringify(b))).length);
  });

  it("handle empty lists", async () => {
    const b = batch(0);
    expect(JSON.parse(unpack(await packBatch(b), "br").toString("utf8"))).toEqual(JSON.parse(JSON.stringify(b)));
  });

  it("still read older gzip copies", () => {
    const b = batch(10);
    expect(JSON.parse(unpack(gzipSync(Buffer.from(JSON.stringify(b)))).toString("utf8"))).toEqual(JSON.parse(JSON.stringify(b)));
  });
});
