import { beforeEach, describe, expect, it } from "vitest";
import { cmd, resetMemory } from "@/lib/community/kv";
import { signUp } from "@/lib/community/service";
import { cleanSharedTrip, getSharedTrip, likeSharedTrip, listSharedTrips, mySharedTrips, reportSharedTrip, shareTrip, unshareTrip, usedSharedTrip } from "@/lib/community/shared-trips";

const A = "a".repeat(32);
const B = "b".repeat(32);
const C = "c".repeat(32);
const D = "d".repeat(32);
const ids: Record<string, string> = {};

async function member(secret: string, name: string) {
  const p = await signUp(secret, { firstName: name, lastName: "Teste", username: name.toLowerCase(), email: `${name.toLowerCase()}@example.com`, password: "três palavras juntas" }, `ip-${name}`);
  ids[secret] = p.id;
}

const trip = (o: Record<string, unknown> = {}) => ({
  name: "Portugal with Ana",
  emoji: "🇵🇹",
  about: "Slow days, long lunches.",
  month: 12,
  stops: [
    { name: "Lisbon", cc: "PT", lat: 38.72234, lng: -9.13931, nights: 3, cityId: "lisbon", see: ["Belém Tower", "Ramiro", "x"] },
    { name: "Porto", cc: "PT", lat: 41.1579, lng: -8.6291, nights: 2 },
  ],
  ...o,
});

beforeEach(async () => {
  resetMemory();
  await member(A, "Ana");
  await member(B, "Bruno");
  await member(C, "Carla");
  await member(D, "Duarte");
});

describe("a shared trip", () => {
  it("is cleaned: rounded places, valid nights, names only, no links", () => {
    const t = cleanSharedTrip(trip({ emoji: "<b>", stops: [{ name: " Lisbon  <script> ", lat: 38.72234, lng: -9.1, nights: 99, cityId: "NOPE", see: ["ok place"] }] }));
    expect(t).toMatchObject({ name: "Portugal with Ana", emoji: "✈️", nights: 1, km: 0, month: 12 });
    expect(t.stops[0]).toEqual({ name: "Lisbon script", cc: undefined, lat: 38.722, lng: -9.1, nights: 1, cityId: undefined, see: ["ok place"] });
    expect(() => cleanSharedTrip(trip({ name: "ab" }))).toThrow(/name/);
    expect(() => cleanSharedTrip(trip({ stops: [] }))).toThrow(/at least one city/);
    expect(() => cleanSharedTrip(trip({ stops: [{ name: "X", lat: 200, lng: 0, nights: 1 }] }))).toThrow(/isn't right/);
    expect(() => cleanSharedTrip(trip({ about: "see https://spam.example" }))).toThrow(/Links/);
    expect(() => cleanSharedTrip(trip({ about: "call me on +351 912 345 678" }))).toThrow(/phone numbers/);
  });

  it("needs an account, and shows with its author, likes and uses", async () => {
    await expect(shareTrip("z".repeat(32), trip())).rejects.toThrow(/account/);
    const t = await shareTrip(A, trip());
    expect(t).toMatchObject({ name: "Portugal with Ana", nights: 5, mine: true, likes: 0, uses: 0 });
    expect(t.km).toBeGreaterThan(250);
    expect(t.by?.username).toBe("ana");
    expect((await getSharedTrip(t.id, ids[B]))?.mine).toBeUndefined();
    expect((await mySharedTrips(A)).map((x) => x.id)).toEqual([t.id]);
    const list = await listSharedTrips({ sort: "new" });
    expect(list.total).toBe(1);
  });

  it("is changed and taken down by its author only", async () => {
    const t = await shareTrip(A, trip());
    await expect(shareTrip(B, trip({ id: t.id, name: "Mine now" }))).rejects.toThrow(/Only who shared/);
    const changed = await shareTrip(A, trip({ id: t.id, name: "Portugal, slowly" }));
    expect(changed.name).toBe("Portugal, slowly");
    expect(changed.id).toBe(t.id);
    await expect(unshareTrip(B, t.id)).rejects.toThrow(/Only who shared/);
    await unshareTrip(A, t.id);
    expect(await getSharedTrip(t.id)).toBeUndefined();
    expect((await listSharedTrips({})).trips).toEqual([]);
  });

  it("goes up the list with likes and with people planning from it", async () => {
    const a = await shareTrip(A, trip());
    const b = await shareTrip(B, trip({ name: "Italy by train" }));
    expect(await likeSharedTrip(C, b.id)).toEqual({ liked: true, likes: 1 });
    expect((await listSharedTrips({ sort: "top" })).trips.map((t) => t.name)).toEqual(["Italy by train", "Portugal with Ana"]);
    expect(await likeSharedTrip(C, b.id)).toEqual({ liked: false, likes: 0 });
    // Planned from four times, by two people: counted twice.
    for (const who of ["ip-1", "ip-1", "ip-2", "ip-2"]) await usedSharedTrip(a.id, who);
    const top = (await listSharedTrips({ sort: "top" })).trips;
    expect(top[0]).toMatchObject({ name: "Portugal with Ana", uses: 2 });
  });

  it("is hidden after three reports, but not by its author", async () => {
    const t = await shareTrip(A, trip());
    await expect(reportSharedTrip(A, t.id)).rejects.toThrow(/your own/);
    await reportSharedTrip(B, t.id);
    await reportSharedTrip(C, t.id);
    expect((await listSharedTrips({})).trips.length).toBe(1);
    await reportSharedTrip(D, t.id);
    expect((await listSharedTrips({})).trips.length).toBe(0);
    expect((await getSharedTrip(t.id, ids[B]))).toBeUndefined();
    // Its author still sees it.
    expect((await getSharedTrip(t.id, ids[A]))?.hidden).toBe(true);
  });

  it("is limited: 30 each", async () => {
    for (let i = 0; i < 30; i++) await cmd(["SADD", `c:ust:${ids[A]}`, `fake${i}`]);
    await expect(shareTrip(A, trip())).rejects.toThrow(/30 trips/);
  });
});
