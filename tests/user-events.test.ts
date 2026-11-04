import { beforeEach, describe, expect, it } from "vitest";
import { cmd, resetMemory } from "@/lib/community/kv";
import { signUp } from "@/lib/community/service";
import {
  __testing, createUserEvent, deleteUserEvent, editableUserEvent, loadAllUserEvents, myUserEvents, reportUserEvent, setCancelled, toBatch, updateUserEvent, validate,
} from "@/lib/user-events";
import { cleanUrl, listingTextProblem } from "@/lib/user-events-shared";

const A = "a".repeat(32);
const B = "b".repeat(32);
const C = "c".repeat(32);
const D = "d".repeat(32);
const ids: Record<string, string> = {};

async function member(secret: string, name: string) {
  const p = await signUp(secret, { firstName: name, lastName: "Teste", username: name.toLowerCase(), email: `${name.toLowerCase()}@example.com`, password: "três palavras juntas" }, `ip-${name}`);
  ids[secret] = p.id;
}

/** A date some days from now, as the venue's calendar day. */
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const input = (o: Record<string, unknown> = {}) => ({
  title: "Fado ao Luar",
  category: "music",
  tagline: "An evening of fado by the river",
  description: "Three voices, two guitars and the Tagus at night. Doors open half an hour before.",
  genres: ["fado", "acoustic", "fado"],
  performers: ["Ana Moura Tribute Trio", "Rui Guitarra"],
  date: day(10),
  time: "21:30",
  endTime: "23:30",
  repeat: { kind: "none" },
  venue: { name: "Clube Ferroviário", address: "Rua de Santa Apolónia 59", city: "Lisboa", country: "Portugal", countryCode: "pt", lat: 38.7139, lng: -9.1225 },
  access: "ticketed",
  priceMin: 12,
  priceMax: 20,
  currency: "EUR",
  ticketUrl: "tickets.example.com/fado",
  ageMin: 0,
  familyFriendly: true,
  accessibility: ["Step-free access"],
  languages: ["Portuguese"],
  imageUrl: "https://images.example.com/fado.jpg",
  hue: 30,
  organiser: { name: "Noites de Fado", url: "https://noitesdefado.example.com" },
  website: "https://noitesdefado.example.com/luar",
  agree: true,
  ...o,
});

beforeEach(async () => {
  resetMemory();
  __testing.resetCache();
  await member(A, "Ana");
  await member(B, "Bruno");
  await member(C, "Carla");
  await member(D, "Duarte");
});

describe("checking a listing", () => {
  it("works out the venue's time zone and the start and end in UTC", () => {
    const v = validate(input({ date: "2027-01-15" }));
    expect(v.timeZone).toBe("Europe/Lisbon");
    expect(v.start).toBe("2027-01-15T21:30:00.000Z"); // winter: Lisbon is on UTC
    expect(v.end).toBe("2027-01-15T23:30:00.000Z");
    expect(v.venue.countryCode).toBe("PT");
    expect(v.genres).toEqual(["fado", "acoustic"]);
    expect(v.ticketUrl).toBe("https://tickets.example.com/fado");
  });
  it("runs past midnight when the end time is earlier than the start", () => {
    const v = validate(input({ date: "2027-07-02", time: "22:00", endTime: "04:00" }));
    expect(v.start).toBe("2027-07-02T21:00:00.000Z"); // summer: UTC+1
    expect(v.end).toBe("2027-07-03T03:00:00.000Z");
  });
  it("repeats weekly at the same local time, and on chosen dates", () => {
    const w = validate(input({ date: "2027-03-20", time: "20:00", endTime: undefined, repeat: { kind: "weekly", weeks: 3 } }));
    // The clocks change on 28 March: the 3 April show is still at 20:00 local.
    expect(w.schedule).toEqual(["2027-03-27T20:00:00.000Z", "2027-04-03T19:00:00.000Z"]);
    const d = validate(input({ date: "2027-05-01", endTime: undefined, repeat: { kind: "dates", dates: ["2027-05-08", "2027-05-01", "2027-05-15"] } }));
    expect(d.schedule).toHaveLength(2);
    expect(() => validate(input({ date: "2027-05-10", endTime: undefined, repeat: { kind: "dates", dates: ["2027-05-01"] } }))).toThrow(/after the first date/);
  });
  it("finds the country code from the country's name", () => {
    expect(validate(input({ venue: { ...input().venue, countryCode: undefined, country: "Spain", city: "Madrid", lat: 40.4168, lng: -3.7038 } })).venue.countryCode).toBe("ES");
  });
  it("refuses what doesn't make sense", () => {
    expect(() => validate(input({ date: day(-3) }))).toThrow(/past/);
    expect(() => validate(input({ date: day(900) }))).toThrow(/two years/);
    expect(() => validate(input({ endDate: day(9) }))).toThrow(/after the start/);
    expect(() => validate(input({ priceMin: undefined }))).toThrow(/price/);
    expect(() => validate(input({ priceMin: 30, priceMax: 10 }))).toThrow(/lower/);
    expect(() => validate(input({ category: "not-a-category" }))).toThrow(/category/);
    expect(() => validate(input({ title: "ab" }))).toThrow();
    expect(() => validate(input({ description: "Too short." }))).toThrow();
    expect(() => validate(input({ agree: false }))).toThrow(/Confirm/);
    expect(() => validate(input({ imageUrl: "http://insecure.example.com/a.jpg" }))).toThrow(/secure/);
    expect(() => validate(input({ website: "javascript:alert(1)" }))).toThrow(/web address/);
    expect(() => validate(input({ description: "Great night out! Pay by MB Way to reserve your seat at the door, see you there." }))).toThrow(/Payment/);
    expect(() => validate(input({ description: "Call 912 345 678 to book a table for the whole evening by the river." }))).toThrow(/phone/);
  });
  it("forgets prices on free events, and keeps prices on paid ones", () => {
    const v = validate(input({ access: "free" }));
    expect([v.priceMin, v.priceMax, v.currency]).toEqual([undefined, undefined, undefined]);
  });
  it("only accepts real web addresses", () => {
    expect(cleanUrl("example.com/x")).toBe("https://example.com/x");
    expect(cleanUrl("ftp://example.com")).toBeUndefined();
    expect(cleanUrl("https://user:pw@example.com")).toBeUndefined();
    expect(cleanUrl("localhost")).toBeUndefined();
    expect(listingTextProblem("Doors at 20:00 on 12/12/2026, tickets 2026")).toBeUndefined();
  });
});

describe("listing, changing and removing", () => {
  it("lists an event that then shows in the catalogue with its venue, line-up and ticket offer", async () => {
    const { id, slug } = await createUserEvent(A, input(), "ip-a");
    expect(slug).toMatch(new RegExp(`^fado-ao-luar-lisboa-${id}$`));
    const batch = toBatch(await loadAllUserEvents());
    expect(batch.events).toHaveLength(1);
    const e = batch.events[0];
    expect(e).toMatchObject({ slug, title: "Fado ao Luar", categorySlug: "music", groupSlug: "music", status: "on_sale", ticketAccess: "ticketed", isFree: false, timeZone: "Europe/Lisbon", posterHue: 30 });
    expect(e.listedBy).toMatchObject({ id: ids[A], name: "Ana Teste", username: "ana", organiser: "Noites de Fado" });
    expect(e.tagline).toBe("An evening of fado by the river");
    expect(e.description).toContain("Three voices");
    expect(batch.venues[0]).toMatchObject({ name: "Clube Ferroviário", city: "Lisboa", countryCode: "PT", cityId: "lisbon", timeZone: "Europe/Lisbon" });
    expect(batch.participants.map((p) => p.name)).toEqual(["Ana Moura Tribute Trio", "Rui Guitarra"]);
    expect(e.participants[0].role).toBe("headliner");
    expect(batch.offers[0]).toMatchObject({ provider: "Noites de Fado", providerType: "organizer", basePrice: 12, maxPrice: 20, currency: "EUR", purchaseUrl: "https://tickets.example.com/fado" });
  });

  it("lets only its owner edit, cancel or remove it", async () => {
    const { id } = await createUserEvent(A, input(), "ip-a");
    await expect(updateUserEvent(B, id, input({ title: "Hijacked" }))).rejects.toThrow(/Only the member/);
    await expect(deleteUserEvent(B, id)).rejects.toThrow(/Only the member/);
    await expect(editableUserEvent(B, id)).rejects.toThrow(/Only the member/);

    const r = await updateUserEvent(A, id, input({ title: "Fado ao Luar: Especial" }));
    expect(r.slug).toContain("fado-ao-luar-especial");
    const form = await editableUserEvent(A, id);
    expect(form).toMatchObject({ title: "Fado ao Luar: Especial", date: input().date, time: "21:30", access: "ticketed" });
    expect(form).not.toHaveProperty("owner");

    await setCancelled(A, id, true);
    expect(toBatch(await loadAllUserEvents()).events[0].status).toBe("cancelled");
    expect((await myUserEvents(A)).map((e) => [e.id, e.cancelled])).toEqual([[id, true]]);

    await deleteUserEvent(A, id);
    expect(toBatch(await loadAllUserEvents()).events).toHaveLength(0);
    expect(await myUserEvents(A)).toEqual([]);
  });

  it("needs an account, and caps how many a member lists a day", async () => {
    await expect(createUserEvent("x".repeat(32), input(), "ip-x")).rejects.toThrow(/account/);
    for (let i = 0; i < 5; i++) await createUserEvent(A, input({ title: `Night ${i + 1}` }), "ip-a");
    await expect(createUserEvent(A, input({ title: "Night 6" }), "ip-a")).rejects.toThrow(/a lot of events today/);
  });

  it("lists ticket types as separate offers, a programme in order, and a Studio poster when there's no picture", async () => {
    const { id } = await createUserEvent(
      A,
      input({
        priceMin: undefined,
        priceMax: undefined,
        tiers: [{ name: "Early bird", price: 10 }, { name: "Regular", price: 15 }, { name: "VIP", price: 40 }],
        programme: [{ time: "22:00", title: "Main set" }, { time: "21:00", title: "Doors open" }],
        imageUrl: undefined,
        posterStyle: "neon",
      }),
      "ip-a",
    );
    const batch = toBatch(await loadAllUserEvents());
    expect(batch.offers.map((o) => [o.label, o.basePrice])).toEqual([["Early bird", 10], ["Regular", 15], ["VIP", 40]]);
    expect(batch.events[0].programme).toEqual([{ time: "21:00", title: "Doors open" }, { time: "22:00", title: "Main set" }]);
    expect(batch.events[0].imageUrl).toMatch(new RegExp(`^/api/poster/${id}\\?s=neon&v=[a-z0-9]+$`));
    const form = await editableUserEvent(A, id);
    expect(form).toMatchObject({ posterStyle: "neon", priceMin: 10, priceMax: 40 });
    expect(form.tiers).toHaveLength(3);
    expect(() => validate(input({ programme: [{ time: "25:00", title: "Late" }] }))).toThrow(/time/);
    expect(() => validate(input({ tiers: [{ name: "Pay by MB Way", price: 5 }] }))).toThrow(/Payment/);
  });

  it("takes an event off the site after three members report it", async () => {
    const { id } = await createUserEvent(A, input(), "ip-a");
    await expect(reportUserEvent(A, id)).rejects.toThrow(/your own/);
    await reportUserEvent(B, id);
    await reportUserEvent(B, id); // the same member twice counts once
    await reportUserEvent(C, id);
    expect(toBatch(await loadAllUserEvents()).events).toHaveLength(1);
    await reportUserEvent(D, id);
    expect(toBatch(await loadAllUserEvents()).events).toHaveLength(0);
  });

  it("leaves past events out of the catalogue and reads storage again only after a change", async () => {
    const { id } = await createUserEvent(A, input(), "ip-a");
    const first = await loadAllUserEvents();
    expect(await loadAllUserEvents()).toBe(first); // nothing changed: the same list
    const stored = JSON.parse((await cmd(["GET", `ue:e:${id}`])) as string);
    const past = { ...stored, start: new Date(Date.now() - 3 * 864e5).toISOString(), end: new Date(Date.now() - 3 * 864e5 + 7200000).toISOString() };
    expect(toBatch([past]).events).toHaveLength(0);
  });
});
