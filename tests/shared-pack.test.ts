import { describe, expect, it } from "vitest";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { packBatch, unpack, unpackLines } from "@/lib/shared-cache";
import type { ProviderBatch } from "@/lib/providers/types";

const batch = (n: number): ProviderBatch =>
  ({
    events: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, title: `Concert ${i} — “quoted” ünïcode 🎵 line\nbreak`, description: "The same long tour text, repeated on every date. ".repeat(8), start: "2026-12-01T20:00:00Z", isFree: i % 2 === 0, tags: i % 3 ? ["a", "b"] : undefined })),
    venues: [{ id: "v1", name: "Hall" }],
    participants: [],
    offers: Array.from({ length: 3 }, (_, i) => ({ id: `o${i}`, eventId: `e${i}` })),
  }) as unknown as ProviderBatch;

const plain = (b: ProviderBatch) => JSON.parse(JSON.stringify(b));

describe("shared copies", () => {
  it("are written in lines and read back to the same data", async () => {
    const b = batch(4500);
    const packed = await packBatch(b);
    expect(plain(await unpackLines(packed))).toEqual(plain(b));
    // Far smaller than gzip for repeated text.
    expect(packed.length).toBeLessThan(gzipSync(Buffer.from(JSON.stringify(b))).length);
  });

  it("handle empty lists", async () => {
    const b = batch(0);
    expect(plain(await unpackLines(await packBatch(b)))).toEqual(plain(b));
  });

  it("give the server back between lines while reading", async () => {
    const packed = await packBatch(batch(9000));
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    await unpackLines(packed);
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(2);
  });

  it("refuse a damaged copy", async () => {
    const packed = await packBatch(batch(10));
    await expect(unpackLines(packed.subarray(0, packed.length - 5))).rejects.toThrow();
  });

  it("still read older copies (one document, Brotli or gzip)", () => {
    const b = batch(10);
    const json = Buffer.from(JSON.stringify(b));
    expect(JSON.parse(unpack(gzipSync(json)).toString("utf8"))).toEqual(plain(b));
    expect(JSON.parse(unpack(brotliCompressSync(json), "br").toString("utf8"))).toEqual(plain(b));
  });
});
