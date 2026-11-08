import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProviderBatch } from "@/lib/providers/types";

/**
 * The store shared by server instances, backed by Vercel's Runtime Cache when the site runs on
 * Vercel (here its in-memory stand-in): snapshots split into chunks, locks and small state.
 */

type SC = typeof import("@/lib/shared-cache");
let sc: SC;
const was = process.env.VERCEL;

beforeAll(async () => {
  process.env.VERCEL = "1";
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  sc = await import("@/lib/shared-cache");
});
afterAll(() => {
  process.env.VERCEL = was;
  vi.restoreAllMocks();
});

function bigBatch(n: number): ProviderBatch {
  // Random text compresses badly, so the snapshot spans several chunks.
  const noise = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return {
    events: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, title: `Event ${i} ${noise()} ${noise()} ${noise()}` }) as never),
    venues: [],
    participants: [],
    offers: [],
  };
}

describe("shared store on Vercel's Runtime Cache", () => {
  it("is on", () => {
    expect(sc.sharedEnabled).toBe(true);
    expect(sc.sharedStoreUp()).toBe(true);
  });

  it("saves a big snapshot in chunks and reads it back whole", async () => {
    const batch = bigBatch(40000);
    await sc.saveSnapshot("helsinki", batch, 1_700_000_000_000);
    const index = await sc.snapshotIndex(["helsinki", "berlin"]);
    expect(Object.keys(index)).toEqual(["helsinki"]);
    expect(index.helsinki.n).toBeGreaterThan(1);
    expect(index.helsinki.events).toBe(40000);
    const back = await sc.loadSnapshot("helsinki", index.helsinki);
    expect(back?.events.length).toBe(40000);
    expect(back?.events[123]).toEqual(batch.events[123]);
  });

  it("a newer copy replaces the older one", async () => {
    await sc.saveSnapshot("helsinki", bigBatch(10), 1_800_000_000_000);
    const index = await sc.snapshotIndex(["helsinki"]);
    expect(index.helsinki.events).toBe(10);
    expect((await sc.loadSnapshot("helsinki", index.helsinki))?.events.length).toBe(10);
  });

  it("locks: one holder at a time until released or expired", async () => {
    expect(await sc.acquireLock("sync:berlin", 60)).toBe(true);
    expect(await sc.acquireLock("sync:berlin", 60)).toBe(false);
    await sc.releaseLock("sync:berlin");
    expect(await sc.acquireLock("sync:berlin", 60)).toBe(true);
  });

  it("keeps small state", async () => {
    await sc.setState("localist:crawl", { queue: ["a", "b"] });
    expect(await sc.getState("localist:crawl")).toEqual({ queue: ["a", "b"] });
    expect(await sc.getStates(["localist:crawl", "nope"])).toEqual([{ queue: ["a", "b"] }, undefined]);
    await sc.setState("localist:crawl", undefined);
    expect(await sc.getState("localist:crawl")).toBeUndefined();
  });
});
