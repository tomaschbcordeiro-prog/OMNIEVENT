import { beforeEach, describe, expect, it } from "vitest";
import { cmd, resetMemory } from "@/lib/community/kv";
import { getHome, getProfile, signUp } from "@/lib/community/service";
import { FOUNDING_LIMIT, isFounding, KIND_META, STARTERS } from "@/lib/community/types";
import { toAskAbout, whenItWas, reviewHref } from "@/lib/after-event";

const person = (n: number) => ({ firstName: "Ana", lastName: `Silva${"x".repeat(n % 3)}`, username: `ana.${n}`, email: `ana${n}@example.com`, password: "pasteis-de-nata-42" });
const key = (n: number) => String(n).padStart(32, "k");

beforeEach(() => resetMemory());

describe("member numbers and founding members", () => {
  it("numbers members in the order they join and calls the first ones founding members", async () => {
    const a = await signUp(key(1), person(1), "ip1");
    const b = await signUp(key(2), person(2), "ip2");
    expect(a.no).toBe(1);
    expect(b.no).toBe(2);
    expect(a.badges).toContain("founding");
  });

  it("starts numbering after the members there were before numbering began", async () => {
    await cmd(["HSET", "c:stat", "members", 41]);
    const p = await signUp(key(3), person(3), "ip3");
    expect(p.no).toBe(42);
  });

  it("founding: the first 1,000, or anyone who joined before launch without a number", () => {
    expect(isFounding({ no: FOUNDING_LIMIT, createdAt: "2030-01-01T00:00:00Z" })).toBe(true);
    expect(isFounding({ no: FOUNDING_LIMIT + 1, createdAt: "2026-01-01T00:00:00Z" })).toBe(false);
    expect(isFounding({ createdAt: "2026-11-10T00:00:00Z" })).toBe(true);
    expect(isFounding({ createdAt: "2028-01-01T00:00:00Z" })).toBe(false);
  });

  it("welcomes the newest members on the community's home, newest first", async () => {
    for (let i = 1; i <= 14; i++) await signUp(key(10 + i), person(10 + i), `ip${i}`);
    const home = await getHome();
    expect(home.newcomers?.length).toBe(12);
    expect(home.newcomers?.[0].username).toBe("ana.24");
    expect((await getProfile(home.newcomers![0].id))?.no).toBe(14);
  });
});

describe("conversation starters", () => {
  it("offers a few openings on every kind of page, each a known kind of post", () => {
    for (const [mode, list] of Object.entries(STARTERS)) {
      expect(list.length, mode).toBeGreaterThanOrEqual(3);
      for (const s of list) {
        expect(KIND_META[s.kind], `${mode}: ${s.label}`).toBeDefined();
        expect(s.text.length).toBeGreaterThan(5);
      }
    }
  });
});

describe("how was it?", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  const ev = (id: string, start: string, extra: Record<string, unknown> = {}) => ({ id, start, eventType: "single", ...extra });

  it("asks about saved events that ended in the last days, most recent first", () => {
    const cards = [
      ev("last-night", "2026-11-11T20:00:00Z"),
      ev("too-soon", "2026-11-12T10:30:00Z"),
      ev("upcoming", "2026-11-14T20:00:00Z"),
      ev("long-ago", "2026-10-01T20:00:00Z"),
      ev("museum", "2026-11-10T10:00:00Z", { eventType: "daily_attraction" }),
      ev("festival", "2026-11-10T10:00:00Z", { eventType: "multi_day" }),
      ev("exhibition-on", "2026-11-09T10:00:00Z", { ongoing: true }),
      ev("sunday", "2026-11-08T18:00:00Z"),
      ev("answered", "2026-11-10T18:00:00Z"),
      ev("no-time-today", "2026-11-12T00:00:00Z", { hoursUnknown: true }),
      ev("no-time-tuesday", "2026-11-10T00:00:00Z", { hoursUnknown: true }),
    ];
    expect(toAskAbout(cards, ["answered"], now).map((c) => c.id)).toEqual(["last-night", "no-time-tuesday", "sunday"]);
  });

  it("says when it was, from the event's own clock", () => {
    expect(whenItWas("2026-11-11T20:00:00Z", "Europe/Lisbon", now)).toBe("yesterday");
    expect(whenItWas("2026-11-12T08:00:00Z", "Europe/Lisbon", now)).toBe("today");
    expect(whenItWas("2026-11-08T18:00:00Z", "Europe/Lisbon", now)).toBe("on Sunday");
    expect(whenItWas("2026-11-01T18:00:00Z", "Europe/Lisbon", now)).toBe("on 1 Nov");
  });

  it("links to the event with the review box ready, or to its venue once it's gone", () => {
    const c = { slug: "fado-1", title: "Noite de Fado", venueSlug: "clube-de-fado" };
    expect(reviewHref(c, 4)).toBe("/events/fado-1?review=4#community");
    expect(reviewHref(c)).toBe("/events/fado-1?review=0#community");
    expect(reviewHref(c, 5, false)).toBe("/venues/clube-de-fado?review=5&about=Noite%20de%20Fado#community");
    expect(reviewHref({ slug: "x", title: "X" }, 3, false)).toBe("/events/x?review=3#community");
  });
});
