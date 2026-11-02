import { beforeEach, describe, expect, it } from "vitest";
import { cmd, resetMemory } from "@/lib/community/kv";
import { getProfile, memberOf, signUp } from "@/lib/community/service";
import { DUEL_CITIES, ROUNDS, dayOf, getDuel, pickRounds, voteDuel, type DuelSource } from "@/lib/community/duel";
import type { EventCard } from "@/lib/types";

const A = "a".repeat(32);
const B = "b".repeat(32);
const GUEST = "g".repeat(32);
const NOW = Date.parse("2026-11-03T12:00:00Z");
const DAY = 86400000;

const groups = ["music", "theatre", "comedy", "exhibitions", "sports", "cinema"];
const card = (i: number, o: Partial<EventCard> = {}): EventCard =>
  ({
    id: `e${i}`,
    slug: `event-${i}`,
    title: `Event ${i}`,
    categorySlug: groups[i % groups.length],
    groupSlug: groups[i % groups.length],
    start: new Date(NOW + (i + 1) * 3600000).toISOString(),
    timeZone: "Europe/Lisbon",
    status: "scheduled",
    ticketAccess: "ticketed",
    isFree: false,
    familyFriendly: false,
    online: false,
    venueName: `Venue ${i}`,
    venueSlug: `venue-${i}`,
    city: "Lisbon",
    country: "Portugal",
    lat: 38.7,
    lng: -9.1,
    imageUrl: `https://img.example/${i}.jpg`,
    people: [],
    providers: ["test"],
    isDemo: false,
    provider: "test",
    lastSyncedAt: "",
    eventType: "single",
    ...o,
  }) as EventCard;

const cards = Array.from({ length: 12 }, (_, i) => card(i));
let asked: string[] = [];
const source: DuelSource = async (cityId) => {
  asked.push(cityId);
  return { city: cityId === "lisbon" ? "Lisbon" : cityId, cards: cityId === "nowhere" ? [] : cards };
};

beforeEach(async () => {
  resetMemory();
  asked = [];
  await signUp(A, { firstName: "Ana", lastName: "Teste", username: "ana", email: "ana@example.com", password: "três palavras juntas" }, "ip-a");
});

describe("picking the rounds", () => {
  it("makes three rounds of two different kinds, no event twice, the same every time", () => {
    const r = pickRounds("2026-11-03", cards);
    expect(r).toHaveLength(ROUNDS);
    for (const x of r) expect(x.a.groupSlug).not.toBe(x.b.groupSlug);
    expect(new Set(r.flatMap((x) => [x.a.id, x.b.id])).size).toBe(ROUNDS * 2);
    expect(pickRounds("2026-11-03", [...cards].reverse())).toEqual(r);
    expect(pickRounds("2026-11-04", cards)).not.toEqual(r);
  });
  it("leaves out cancelled, online, always-open and repeated events, and prefers real ones with pictures", () => {
    const bad = [card(20, { status: "cancelled" }), card(21, { online: true }), card(22, { eventType: "daily_attraction" }), card(23, { title: "Event 0" })];
    const r = pickRounds("2026-11-03", [...bad, ...cards, card(30, { isDemo: true }), card(31, { imageUrl: undefined })]);
    const used = r.flatMap((x) => [x.a.id, x.b.id]);
    for (const id of ["e20", "e21", "e22", "e23", "e30", "e31"]) expect(used).not.toContain(id);
  });
});

describe("the daily duel", () => {
  it("is made once a day in that day's city and kept", async () => {
    const d = await getDuel(undefined, source, NOW);
    const n = Math.floor(Date.parse("2026-11-03T00:00:00Z") / DAY);
    expect(d).toMatchObject({ day: "2026-11-03", cityId: DUEL_CITIES[n % DUEL_CITIES.length], players: 0, nextAt: "2026-11-04T00:00:00.000Z" });
    expect(d!.rounds).toHaveLength(ROUNDS);
    // A second server reads the kept duel instead of making its own.
    expect(await getDuel(undefined, undefined, NOW)).toEqual(d);
    expect(asked).toHaveLength(1);
  });
  it("hides the votes until you pick, then counts one pick per person and round", async () => {
    await getDuel(undefined, source, NOW);
    const ana = await memberOf(A);
    const first = await voteDuel(A, { day: "2026-11-03", round: 0, pick: "a" }, "ip-a", NOW);
    expect(first).toMatchObject({ votes: { a: 1, b: 0 }, mine: "a", players: 1, streak: { days: 1, playedToday: true } });
    // Changing your mind keeps the first pick.
    expect(await voteDuel(A, { day: "2026-11-03", round: 0, pick: "b" }, "ip-a", NOW)).toMatchObject({ votes: { a: 1, b: 0 }, mine: "a" });
    await voteDuel(B, { day: "2026-11-03", round: 0, pick: "b" }, "ip-b", NOW);
    const mine = await getDuel(ana, undefined, NOW);
    expect(mine!.rounds[0]).toMatchObject({ mine: "a", votes: { a: 1, b: 1 } });
    expect(mine!.rounds[1].votes).toBeUndefined();
    expect(mine!.players).toBe(2);
    const guest = await getDuel(await memberOf(GUEST), undefined, NOW);
    expect(guest!.rounds[0].votes).toBeUndefined();
  });
  it("counts a streak of days in a row, and gives members a point a day", async () => {
    const ana = (await memberOf(A))!;
    const before = (await getProfile(ana))!.karma;
    for (const [i, t] of [NOW, NOW + DAY, NOW + 2 * DAY].entries()) {
      await getDuel(undefined, source, t);
      const r = await voteDuel(A, { day: dayOf(t), round: 0, pick: "a" }, "ip-a", t);
      await voteDuel(A, { day: dayOf(t), round: 1, pick: "b" }, "ip-a", t);
      expect(r.streak).toMatchObject({ days: i + 1, best: i + 1 });
    }
    expect((await getProfile(ana))!).toMatchObject({ karma: before + 3, counts: { duels: 3 } });
    // A missed day starts again from one, and the best run is kept.
    const later = NOW + 4 * DAY;
    expect((await getDuel(ana, source, later))!.streak).toMatchObject({ days: 0, best: 3, playedToday: false });
    expect((await voteDuel(A, { day: dayOf(later), round: 2, pick: "b" }, "ip-a", later)).streak).toMatchObject({ days: 1, best: 3 });
    // Guests can play too; points are for members.
    expect((await voteDuel(GUEST, { day: dayOf(later), round: 0, pick: "a" }, "ip-g", later)).streak.days).toBe(1);
  });
  it("shows yesterday's winners", async () => {
    await getDuel(undefined, source, NOW);
    await voteDuel(A, { day: "2026-11-03", round: 0, pick: "b" }, "ip-a", NOW);
    await voteDuel(B, { day: "2026-11-03", round: 0, pick: "b" }, "ip-b", NOW);
    await voteDuel(GUEST, { day: "2026-11-03", round: 0, pick: "a" }, "ip-g", NOW);
    const d = await getDuel(undefined, source, NOW + DAY);
    const yesterday = (await getDuel(undefined, undefined, NOW))!;
    expect(d!.yesterday).toMatchObject({ winners: [{ id: yesterday.rounds[0].b.id, pct: 67, votes: 3 }] });
  });
  it("refuses picks for another day, a missing round or a bad side", async () => {
    await getDuel(undefined, source, NOW);
    await expect(voteDuel(A, { day: "2026-11-02", round: 0, pick: "a" }, "ip-a", NOW)).rejects.toThrow(/new duel/);
    await expect(voteDuel(A, { day: "2026-11-03", round: 7, pick: "a" }, "ip-a", NOW)).rejects.toThrow(/isn't part/);
    await expect(voteDuel(A, { day: "2026-11-03", round: 0, pick: "c" }, "ip-a", NOW)).rejects.toThrow(/Pick one/);
    await expect(voteDuel("short", { day: "2026-11-03", round: 0, pick: "a" }, "ip-a", NOW)).rejects.toThrow(/Reload/);
    expect(await cmd(["HGETALL", "c:dc:2026-11-03"])).toEqual([]);
  });
  it("tries the next city when one hasn't enough on", async () => {
    const empty: DuelSource = async (cityId) => {
      asked.push(cityId);
      return { city: cityId, cards: asked.length === 1 ? [] : cards };
    };
    const d = await getDuel(undefined, empty, NOW);
    expect(asked).toHaveLength(2);
    expect(d!.cityId).toBe(asked[1]);
  });
});
