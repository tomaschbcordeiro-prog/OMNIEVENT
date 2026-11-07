import { beforeAll, describe, expect, it } from "vitest";
import { addTrack, BUDGET, energyOf, fillTape, hop, MOODS, rerollTrack, seeded, shuffleTape, tapeDay, tapeName, tapeStats, type MixCandidate, type TapeContext, type Track } from "@/lib/mixtape/plan";
import { tapeWindow, windowLabel } from "@/lib/mixtape/windows";
import { parseTapeQuery, tapeIcs, tapeQuery } from "@/lib/mixtape/share";
import { ensureFresh, mixtapePool, cityStats } from "@/lib/store";

/** Mixtape: a night or weekend in one city as a tape of events, shuffled, locked and shared. */

const TZ = "Europe/Lisbon"; // UTC+0 in November
const at = (day: number, hh: number, mm = 0) => Date.UTC(2026, 10, day, hh, mm); // November 2026
const centre = { lat: 38.7223, lng: -9.1393 };
const near = (i: number) => ({ lat: centre.lat + ((i % 7) - 3) * 0.002, lng: centre.lng + ((i % 5) - 2) * 0.002 });

function pool(): MixCandidate[] {
  const out: MixCandidate[] = [];
  const add = (c: Partial<MixCandidate> & { id: string; group: string }) =>
    out.push({ slug: c.id, title: `Event ${c.id}`, cat: c.group, venue: `Venue ${c.id}`, free: false, img: "x.jpg", ...near(out.length), ...c } as MixCandidate);
  // Concerts and shows every evening and night, Friday to Sunday.
  for (const day of [13, 14, 15])
    for (const [hh, group, cat] of [[19, "theatre", "theatre"], [21, "music", "jazz"], [22, "music", "electronic"], [23, "nightlife", "nightlife"], [20, "comedy", "comedy"], [18, "cinema", "cinema"]] as const)
      add({ id: `${group}-${day}-${hh}`, group, cat, times: [[at(day, hh), at(day, hh + 2)]], price: hh * 1.5 });
  // Daytime: exhibitions to drop in on, a market, a family show, a free walk.
  for (const day of [14, 15]) {
    add({ id: `expo-${day}`, group: "exhibitions", open: [[at(day, 10), at(day, 19)]], price: 8 });
    add({ id: `market-${day}`, group: "food-drink", open: [[at(day, 11), at(day, 18)]], free: true, price: 0 });
    add({ id: `kids-${day}`, group: "family", times: [[at(day, 11), at(day, 12)]], family: true, price: 6 });
    add({ id: `walk-${day}`, group: "outdoor", times: [[at(day, 10), at(day, 12)]], free: true, price: 0 });
  }
  // Something an hour away, and a pricey gala.
  add({ id: "far", group: "music", times: [[at(14, 21), at(14, 23)]], lat: 38.0, lng: -8.0, price: 10 });
  add({ id: "gala", group: "theatre", times: [[at(14, 20), at(14, 23)]], price: 120 });
  return out;
}

const ctx = (over: Partial<TapeContext["vibe"]> = {}, win: [number, number] = [at(13, 17), at(16, 0)]): TapeContext => ({
  tz: TZ,
  from: win[0],
  to: win[1],
  vibe: { energy: 2, budget: 3, range: 2, moods: [], ...over },
  caps: BUDGET.map((b) => b.capEur),
  centre,
});

function noClashes(tape: Track[], byId: Map<string, MixCandidate>) {
  for (let i = 1; i < tape.length; i++) {
    const a = tape[i - 1];
    const b = tape[i];
    const travel = hop(byId.get(a.id)!, byId.get(b.id)!).minutes * 60000;
    expect(b.start).toBeGreaterThanOrEqual(a.end + travel);
  }
}

describe("planning a tape", () => {
  const P = pool();
  const byId = new Map(P.map((c) => [c.id, c]));

  it("fills the tape in time order, inside the window, with no clashes and time to get there", () => {
    for (let s = 1; s <= 20; s++) {
      const tape = fillTape(P, ctx(), [], { n: 5, random: seeded(s) });
      expect(tape).toHaveLength(5);
      expect(new Set(tape.map((t) => t.id)).size).toBe(5);
      expect(tape.map((t) => t.start)).toEqual([...tape.map((t) => t.start)].sort((a, b) => a - b));
      for (const t of tape) {
        expect(t.start).toBeGreaterThanOrEqual(at(13, 17));
        expect(t.start).toBeLessThan(at(16, 0));
        expect(t.end).toBeGreaterThan(t.start);
      }
      noClashes(tape, byId);
    }
  });

  it("spreads a weekend over its days and mixes kinds of event", () => {
    let days = 0, groups = 0;
    for (let s = 1; s <= 20; s++) {
      const tape = fillTape(P, ctx(), [], { n: 5, random: seeded(s) });
      days += new Set(tape.map((t) => tapeDay(t.start, TZ))).size;
      groups += new Set(tape.map((t) => byId.get(t.id)!.group)).size;
    }
    expect(days / 20).toBeGreaterThanOrEqual(2.5);
    expect(groups / 20).toBeGreaterThanOrEqual(3.5);
  });

  it("keeps to the budget and the moods", () => {
    for (let s = 1; s <= 10; s++) {
      const free = fillTape(P, ctx({ budget: 0 }), [], { n: 4, random: seeded(s) });
      expect(free.length).toBeGreaterThan(0);
      for (const t of free) expect(byId.get(t.id)!.price).toBe(0);
      const cheap = fillTape(P, ctx({ budget: 1 }), [], { n: 4, random: seeded(s) });
      for (const t of cheap) expect(byId.get(t.id)!.price!).toBeLessThanOrEqual(15);
      const music = fillTape(P, ctx({ moods: ["music", "night"] }), [], { n: 4, random: seeded(s) });
      for (const t of music) expect(["music", "nightlife"]).toContain(byId.get(t.id)!.group);
    }
    expect(MOODS.length).toBeGreaterThan(5);
  });

  it("follows the energy: a loud tape is livelier than a slow one", () => {
    const avg = (energy: number) => {
      let sum = 0, n = 0;
      for (let s = 1; s <= 30; s++)
        for (const t of fillTape(P, ctx({ energy }), [], { n: 4, random: seeded(s) })) {
          sum += energyOf(byId.get(t.id)!, t.start, TZ);
          n++;
        }
      return sum / n;
    };
    expect(avg(4)).toBeGreaterThan(avg(0) + 0.2);
  });

  it("stays close when walking: the far-away concert is (almost) never picked", () => {
    let far = 0;
    for (let s = 1; s <= 40; s++) if (fillTape(P, ctx({ range: 0 }), [], { n: 5, random: seeded(s) }).some((t) => t.id === "far")) far++;
    expect(far).toBeLessThanOrEqual(1);
  });

  it("shuffles everything but the locked tracks, and avoids what was just shown", () => {
    const tape = fillTape(P, ctx(), [], { n: 5, random: seeded(3) });
    const locked = tape.map((t, i) => (i === 1 ? { ...t, locked: true } : t));
    const next = shuffleTape(P, ctx(), locked, 5, new Set(tape.map((t) => t.id)), seeded(9));
    expect(next).toHaveLength(5);
    expect(next.find((t) => t.id === tape[1].id)?.locked).toBe(true);
    const repeated = next.filter((t) => !t.locked && tape.some((o) => o.id === t.id)).length;
    expect(repeated).toBeLessThanOrEqual(1);
    noClashes(next, byId);
  });

  it("rerolls one track and keeps the rest, near the same time", () => {
    const tape = fillTape(P, ctx(), [], { n: 5, random: seeded(5) });
    const next = rerollTrack(P, ctx(), tape, 2, new Set(), seeded(11));
    expect(next).toHaveLength(5);
    expect(next.some((t) => t.id === tape[2].id)).toBe(false);
    for (const [i, t] of tape.entries()) if (i !== 2) expect(next.some((x) => x.id === t.id && x.start === t.start)).toBe(true);
    noClashes(next, byId);
  });

  it("adds a track where it fits, and returns fewer when nothing else does", () => {
    const tape = fillTape(P, ctx(), [], { n: 3, random: seeded(1) });
    expect(addTrack(P, ctx(), tape, new Set(), seeded(2))).toHaveLength(4);
    // One evening hour: room for one event only.
    const tight = fillTape(P, ctx({}, [at(13, 21), at(13, 22, 30)]), [], { n: 4, random: seeded(1) });
    expect(tight.length).toBeGreaterThan(0);
    expect(tight.length).toBeLessThan(4);
  });

  it("drop-ins get a suggested time inside their opening hours", () => {
    const tape = fillTape(P, ctx({ moods: ["art"] }), [], { n: 2, random: seeded(4) });
    expect(tape.length).toBeGreaterThan(0);
    for (const t of tape) {
      const c = byId.get(t.id)!;
      expect(t.flex).toBe(true);
      expect(c.open!.some(([o, cl]) => t.start >= o && t.end <= cl)).toBe(true);
    }
  });

  it("never suggests dropping in at an odd hour, whatever the source says", () => {
    const odd: MixCandidate = { id: "odd", slug: "odd", title: "Odd hours", group: "exhibitions", cat: "exhibitions", venue: "Somewhere", free: true, price: 0, ...centre, open: [[at(13, 23, 59), at(14, 7, 59)], [at(14, 23, 59), at(15, 7, 59)]] };
    for (let s = 1; s <= 10; s++) expect(fillTape([odd], ctx(), [], { n: 1, random: seeded(s) })).toEqual([]);
  });

  it("starts each day near the centre when walking", () => {
    const far = P.map((c) => (c.id.endsWith("-15-19") || c.id.endsWith("-15-21") ? { ...c, lat: 38.0, lng: -8.0 } : c));
    const byFar = new Map(far.map((c) => [c.id, c]));
    let away = 0;
    for (let s = 1; s <= 30; s++)
      for (const t of fillTape(far, ctx({ range: 0 }), [], { n: 5, random: seeded(s) })) if (byFar.get(t.id)!.lat === 38.0) away++;
    expect(away).toBeLessThanOrEqual(2);
  });

  it("adds up time, money and distance, and names the tape", () => {
    const tape = fillTape(P, ctx(), [], { n: 4, random: seeded(8) });
    const s = tapeStats(tape, byId, TZ);
    expect(s.tracks).toBe(4);
    expect(s.minutes).toBeGreaterThan(60);
    expect(s.cost).toBeGreaterThan(0);
    expect(s.km).toBeGreaterThanOrEqual(0);
    expect(tapeName("Lisbon", { energy: 4, budget: 2, range: 1, moods: [] }, 2)).toContain("Lisbon");
    expect(tapeName("Porto", { energy: 1, budget: 0, range: 1, moods: [] }, 1)).toMatch(/Porto/);
  });
});

describe("when a tape plays", () => {
  const wed = Date.UTC(2026, 10, 11, 10, 0); // Wednesday 11 Nov, 10:00 Lisbon
  it("this weekend runs from Friday evening to Sunday night in the city's own time", () => {
    const w = tapeWindow("weekend", TZ, wed);
    expect(new Date(w.from).toISOString()).toBe("2026-11-13T17:00:00.000Z");
    expect(new Date(w.to).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect([w.fromDate, w.toDate]).toEqual(["2026-11-13", "2026-11-15"]);
    const tokyo = tapeWindow("weekend", "Asia/Tokyo", wed);
    expect(new Date(tokyo.from).toISOString()).toBe("2026-11-13T08:00:00.000Z");
  });
  it("on the weekend itself it starts now; next weekend is the one after", () => {
    const sat = Date.UTC(2026, 10, 14, 15, 7);
    const w = tapeWindow("weekend", TZ, sat);
    expect(new Date(w.from).toISOString()).toBe("2026-11-14T15:15:00.000Z");
    expect(tapeWindow("next-weekend", TZ, sat).fromDate).toBe("2026-11-20");
    expect(tapeWindow("next-weekend", TZ, wed).fromDate).toBe("2026-11-20");
  });
  it("tonight starts at five (or now), and after midnight it is still last night", () => {
    expect(new Date(tapeWindow("tonight", TZ, wed).from).toISOString()).toBe("2026-11-11T17:00:00.000Z");
    const late = tapeWindow("tonight", TZ, Date.UTC(2026, 10, 12, 1, 10));
    expect(new Date(late.from).toISOString()).toBe("2026-11-12T01:15:00.000Z");
    expect(new Date(late.to).toISOString()).toBe("2026-11-12T04:00:00.000Z");
  });
  it("chosen dates are kept to a week and never in the past", () => {
    const w = tapeWindow("dates", TZ, wed, { from: "2026-11-01", to: "2026-12-30" });
    expect(w.fromDate).toBe("2026-11-11");
    expect(w.toDate).toBe("2026-11-18");
    expect(w.tracks).toBeLessThanOrEqual(8);
    expect(windowLabel(tapeWindow("weekend", TZ, wed), TZ)).toBe("This weekend · Fri 13 – Sun 15 Nov");
  });
});

describe("sharing a tape", () => {
  const tracks: Track[] = [
    { id: "lisbon-123", start: Date.UTC(2026, 10, 13, 21, 30), end: Date.UTC(2026, 10, 13, 23, 30) },
    { id: "bol-1_152054", start: Date.UTC(2026, 10, 14, 11, 0), end: Date.UTC(2026, 10, 14, 12, 30), flex: true },
  ];
  it("round-trips through a link", () => {
    const q = tapeQuery({ city: "lisbon", kind: "weekend", fromDate: "2026-11-13", toDate: "2026-11-15", vibe: { energy: 4, budget: 1, range: 0, moods: ["music", "art"] }, name: "Lisbon After Dark", tracks });
    const back = parseTapeQuery(new URLSearchParams(q))!;
    expect(back.city).toBe("lisbon");
    expect(back.vibe).toEqual({ energy: 4, budget: 1, range: 0, moods: ["music", "art"] });
    expect(back.name).toBe("Lisbon After Dark");
    expect(back.tracks).toEqual(tracks.map((t) => ({ ...t, flex: t.flex || undefined })));
    expect(q.length).toBeLessThan(300);
  });
  it("ignores anything malformed", () => {
    expect(parseTapeQuery(new URLSearchParams("c=../etc"))).toBeNull();
    const p = parseTapeQuery({ c: "porto", v: "9x7", t: "ok~abc~1o,<script>~1~1,x~zz~0", m: "music,evil", d: "nope" })!;
    expect(p.vibe.energy).toBe(2);
    expect(p.vibe.moods).toEqual(["music"]);
    expect(p.tracks.map((t) => t.id)).toEqual(["ok"]);
    expect(p.fromDate).toBe("");
  });
  it("makes a calendar file with every track", () => {
    const ics = tapeIcs("Lisbon, After Dark; vol. 1", tracks.map((t) => ({ ...t, title: `A very long title, with commas; and semicolons ${"x".repeat(80)}`, venue: "Village Underground", url: "https://omnievent.vercel.app/events/x" })), Date.UTC(2026, 10, 7));
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("DTSTART:20261113T213000Z");
    expect(ics).toContain("X-WR-CALNAME:Lisbon\\, After Dark\\; vol. 1");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

describe("what a city's tape can be made of", () => {
  beforeAll(async () => {
    delete process.env.TICKETMASTER_API_KEY;
    process.env.DISABLED_PROVIDERS = "paris,madrid,lisbon,venue-calendars,football,bol,catalonia,euskadi,castilla-leon,cultura-portugal,openagenda,nyc-parks,zaragoza,helsinki,taiwan,montreal,berlin,barcelona,chicago,valencia-ivc,espoo,brisbane,localist,pt-municipios,livewhale,mapas-culturais,wikidata";
    await ensureFresh();
  });
  it("gives each event its times (or opening windows) inside the dates asked for", () => {
    const [city] = Object.entries(cityStats()).sort((a, b) => b[1].total - a[1].total)[0];
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10);
    const { items, total } = mixtapePool(city, from, to, 60);
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(60);
    expect(total).toBeGreaterThanOrEqual(items.length);
    const lo = Date.parse(`${from}T00:00:00Z`) - 15 * 3600000;
    const hi = Date.parse(`${to}T00:00:00Z`) + 2 * 864e5;
    for (const c of items) {
      expect(c.times?.length || c.open?.length).toBeTruthy();
      for (const [a, b] of [...(c.times ?? []), ...(c.open ?? [])]) {
        expect(b).toBeGreaterThan(a);
        expect(a).toBeGreaterThan(lo - 864e5);
        expect(a).toBeLessThan(hi);
      }
    }
    expect(mixtapePool("atlantis", from, to).items).toEqual([]);
  });
});
