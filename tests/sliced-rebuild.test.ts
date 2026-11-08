import { describe, expect, it } from "vitest";
import { __testing, catalogueComplete, dataSummary } from "@/lib/store";
import { generateDemoData } from "@/lib/providers/demo";

const copy = (k: number) => {
  const base = generateDemoData(new Date("2026-11-08T10:00:00Z"));
  const sfx = `-s${k}`;
  return {
    events: base.events.map((e) => ({ ...e, id: e.id + sfx, slug: e.slug + sfx, title: `${e.title} ${k}`, venueId: e.venueId + sfx, provenance: { ...e.provenance, provider: `slice${k}`, isDemo: false } })),
    venues: base.venues.map((v) => ({ ...v, id: v.id + sfx, slug: v.slug + sfx })),
    participants: [],
    offers: [],
  };
};

describe("index rebuilt in slices", () => {
  it("installs the whole index when done, and says when it's complete", async () => {
    __testing.load("slice1", copy(1));
    const running = __testing.rebuildSliced();
    expect(catalogueComplete()).toBe(false);
    await running;
    expect(catalogueComplete()).toBe(true);
    expect(dataSummary().total).toBeGreaterThan(2000);
    __testing.drop("slice1");
    __testing.rebuild();
  });
  it("never replaces a newer index with an older one", async () => {
    __testing.load("slice2", copy(2));
    const running = __testing.rebuildSliced();
    // Meanwhile a source arrives and the index is rebuilt at once with it.
    __testing.load("slice3", copy(3));
    __testing.rebuild();
    const withBoth = dataSummary().total;
    await running;
    expect(dataSummary().total).toBe(withBoth);
    __testing.drop("slice2");
    __testing.drop("slice3");
    __testing.rebuild();
  });
});
