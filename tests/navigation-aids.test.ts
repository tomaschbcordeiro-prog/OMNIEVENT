import { describe, expect, it } from "vitest";
import { intentHref } from "@/lib/prefetch";
import { eventSlug, neighbours, slugsOf } from "@/lib/trail";

const O = "https://omnievent.test";
const HERE = `${O}/events?city=lisbon`;

describe("loading pages ahead on intent", () => {
  it("loads the site's own content pages", () => {
    expect(intentHref("/events/noite-de-fado-lisboa-1", HERE, O)).toBe("/events/noite-de-fado-lisboa-1");
    expect(intentHref("/venues/coliseu", HERE, O)).toBe("/venues/coliseu");
    expect(intentHref("/participants/x", HERE, O)).toBe("/participants/x");
    expect(intentHref("/destinations/porto", HERE, O)).toBe("/destinations/porto");
    expect(intentHref("/categories/music?sub=jazz", HERE, O)).toBe("/categories/music?sub=jazz");
    expect(intentHref("/events?city=porto", HERE, O)).toBe("/events?city=porto");
  });

  it("leaves alone other sites, the page showing, and pages that do something", () => {
    expect(intentHref("https://example.com/events/x", HERE, O)).toBeNull();
    expect(intentHref("/events?city=lisbon", HERE, O)).toBeNull();
    expect(intentHref("/events/new", HERE, O)).toBeNull();
    expect(intentHref("/clubs/new", HERE, O)).toBeNull();
    expect(intentHref("/out/abc", HERE, O)).toBeNull();
    expect(intentHref("/api/events", HERE, O)).toBeNull();
    expect(intentHref("/studio/new", HERE, O)).toBeNull();
    expect(intentHref("/my-world", HERE, O)).toBeNull();
    expect(intentHref("/events/a/b/c", HERE, O)).toBeNull();
  });

  it("keeps a link's own query and ignores its anchor", () => {
    expect(intentHref("/events/x#tickets", HERE, O)).toBe("/events/x");
    expect(intentHref("/events?cat=jazz&city=porto", HERE, O)).toBe("/events?cat=jazz&city=porto");
  });
});

describe("stepping through the list an event came from", () => {
  it("reads event slugs from links", () => {
    expect(eventSlug("/events/fado-1")).toBe("fado-1");
    expect(eventSlug("/events/fado-1?x=1")).toBe("fado-1");
    expect(eventSlug("/events/fado-1#tickets")).toBe("fado-1");
    expect(eventSlug("/events/new")).toBeNull();
    expect(eventSlug("/events")).toBeNull();
    expect(eventSlug("/venues/x")).toBeNull();
    expect(eventSlug(null)).toBeNull();
  });

  it("keeps each event once, in order", () => {
    expect(slugsOf(["/events/a", "/venues/v", "/events/b", "/events/a", "/events/c#x"])).toEqual(["a", "b", "c"]);
  });

  it("finds an event's neighbours", () => {
    const t = { back: "/events", slugs: ["a", "b", "c"] };
    expect(neighbours(t, "a")).toEqual({ index: 0, total: 3, prev: undefined, next: "b" });
    expect(neighbours(t, "b")).toEqual({ index: 1, total: 3, prev: "a", next: "c" });
    expect(neighbours(t, "c")).toEqual({ index: 2, total: 3, prev: "b", next: undefined });
    expect(neighbours(t, "z")).toBeNull();
    expect(neighbours({ back: "/", slugs: ["a"] }, "a")).toBeNull();
    expect(neighbours(null, "a")).toBeNull();
  });
});
