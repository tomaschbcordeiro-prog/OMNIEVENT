import { beforeEach, describe, expect, it } from "vitest";
import { applyOps, cleanContent, cleanOp, contentOf, diffContent, listIdeas, moneySummary, moneyText, parseExpense, perTraveller, settleUp, withContent, type TripContent } from "@/lib/trip-share";
import { resetMemory } from "@/lib/community/kv";
import { changeGroup, createGroup, deleteGroup, joinGroup, manageGroup, normalPin, peekGroup, readGroup, type GroupView } from "@/lib/group-trips";

const stop = (id: string, name: string, from: string, to: string) => ({ id, name, lat: 38.7, lng: -9.1, from, to, country: "Portugal", countryCode: "PT" });
const base = (): TripContent => ({
  name: "Portugal",
  start: "2026-12-01",
  end: "2026-12-05",
  stops: [stop("s1", "Lisbon", "2026-12-01", "2026-12-03"), stop("s2", "Porto", "2026-12-03", "2026-12-05")],
  plans: [{ id: "p1", kind: "flight", title: "Flight to Lisbon", day: "2026-12-01", createdAt: "2026-11-01T00:00:00.000Z" }],
  events: [{ id: "e1" }],
  expenses: [],
  checklist: [],
  contacts: [],
  travellers: [
    { id: "ana", name: "Ana" },
    { id: "rui", name: "Rui" },
    { id: "eva", name: "Eva" },
  ],
  messages: [],
});

describe("changes travel as small operations", () => {
  it("diff then apply gives the same trip, in order", () => {
    const a = base();
    const b: TripContent = {
      ...a,
      name: "Portugal in December",
      stops: [a.stops[1], a.stops[0]],
      plans: [...a.plans, { id: "p2", kind: "stay", title: "Hotel", day: "2026-12-01", createdAt: "2026-11-02T00:00:00.000Z" }],
      events: [],
      checklist: [{ id: "c1", list: "packing", text: "Charger", createdAt: "2026-11-02T00:00:00.000Z" }],
    };
    const ops = diffContent(a, b);
    expect(applyOps(a, ops)).toEqual(b);
    expect(ops.some((o) => o.t === "order" && o.c === "stops")).toBe(true);
    expect(diffContent(b, b)).toEqual([]);
  });
  it("two people changing different things both keep their change", () => {
    const server = base();
    const mine = diffContent(server, { ...server, checklist: [{ id: "c1", list: "todo", text: "Insurance", createdAt: "x" }] });
    const theirs = diffContent(server, { ...server, expenses: [{ id: "x1", title: "Hotel", amount: 300, currency: "EUR", category: "stay", createdAt: "x" }] });
    const after = applyOps(applyOps(server, theirs), mine);
    expect(after.checklist).toHaveLength(1);
    expect(after.expenses).toHaveLength(1);
  });
  it("round-trips through a device's trip", () => {
    const c = base();
    const t = withContent({ name: "x", eventIds: [] }, c);
    expect(contentOf(t)).toEqual(c);
  });
});

describe("what arrives is checked", () => {
  it("cleans a whole trip and drops what doesn't belong", () => {
    const c = cleanContent({ ...base(), evil: "<script>", plans: [{ id: "p1", kind: "teleport", title: "  Fly\u0000 ", day: "nope", createdAt: "x", extra: 1 }] });
    expect(c.plans[0]).toMatchObject({ kind: "note", title: "Fly", day: "" });
    expect((c.plans[0] as unknown as Record<string, unknown>).extra).toBeUndefined();
    expect((c as unknown as Record<string, unknown>).evil).toBeUndefined();
  });
  it("refuses broken changes", () => {
    expect(() => cleanOp({ t: "put", c: "expenses", item: { id: "x", title: "Hotel", amount: -5, currency: "EUR" } })).toThrow();
    expect(() => cleanOp({ t: "put", c: "secrets", item: { id: "x" } })).toThrow();
    expect(() => cleanOp({ t: "del", c: "plans", id: "../../etc" })).toThrow();
    expect(cleanOp({ t: "set", f: "budget", v: "1500" })).toEqual({ t: "set", f: "budget", v: 1500 });
  });
});

describe("money", () => {
  const withCosts = (): TripContent => ({
    ...base(),
    currency: "EUR",
    expenses: [
      { id: "x1", title: "Hotel", amount: 300, currency: "EUR", category: "stay", paidBy: "ana", createdAt: "x" },
      { id: "x2", title: "Dinner", amount: 90, currency: "EUR", category: "food", paidBy: "rui", createdAt: "x" },
      { id: "x3", title: "Museum (Ana and Eva)", amount: 30, currency: "EUR", category: "activities", paidBy: "eva", split: ["ana", "eva"], createdAt: "x" },
      { id: "x4", title: "Train (not booked)", amount: 60, currency: "EUR", category: "transport", estimate: true, createdAt: "x" },
    ],
  });
  it("totals by category, booked and estimated", () => {
    const m = moneySummary(withCosts());
    expect(m.total).toBe(480);
    expect(m.booked).toBe(420);
    expect(m.estimated).toBe(60);
    expect(m.byCategory.stay).toBe(300);
  });
  it("splits and settles with the fewest payments", () => {
    const per = perTraveller(withCosts());
    // Hotel 100 each, dinner 30 each, museum 15 for Ana and Eva.
    expect(per.ana).toEqual({ paid: 300, share: 145 });
    expect(per.rui).toEqual({ paid: 90, share: 130 });
    expect(per.eva.share).toBe(145);
    const pay = settleUp(per);
    const net = (id: string) => pay.reduce((n, p) => n + (p.to === id ? p.amount : 0) - (p.from === id ? p.amount : 0), 0);
    // Ana paid more than her share: she gets 155 back; Rui and Eva pay what they owe.
    expect(net("ana")).toBeCloseTo(155);
    expect(net("rui")).toBeCloseTo(-40);
    expect(net("eva")).toBeCloseTo(-115);
    expect(pay.length).toBeLessThanOrEqual(2);
  });
  it("never guesses a currency it doesn't know", () => {
    const m = moneySummary({ currency: "EUR", expenses: [{ id: "x", title: "?", amount: 5, currency: "XYZ", category: "other", createdAt: "x" }] });
    expect(m.total).toBe(0);
    expect(m.unconverted).toHaveLength(1);
  });
  it("list ideas follow the trip and skip what's there", () => {
    const c = { ...base(), checklist: [{ id: "c", list: "todo" as const, text: "Buy travel insurance", createdAt: "x" }] };
    const todo = listIdeas(c, "todo");
    expect(todo).toContain("Check in online for the flight");
    expect(todo).not.toContain("Buy travel insurance");
    expect(todo.some((x) => x.includes("Portugal"))).toBe(true);
    expect(listIdeas(c, "packing")).toContain("Clothes for 4 days");
  });
});

describe("trips planned together (server)", () => {
  beforeEach(() => resetMemory());
  const content = () => {
    const c = base();
    return { ...c, travellers: [] };
  };

  it("start, join by PIN or link, change from both sides, private to members", async () => {
    const { key: ownerKey, view } = await createGroup(content(), "Tomás", "ip1");
    expect(view.role).toBe("owner");
    expect(view.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(view.content.travellers.map((t) => t.name)).toEqual(["Tomás"]);

    // A stranger without a key sees nothing.
    await expect(readGroup(view.id, "x".repeat(32))).rejects.toThrow(/not in this trip/);

    const pin = `${view.code!.slice(0, 4).toLowerCase()}-${view.code!.slice(4)}`;
    expect((await peekGroup({ code: pin }, "ip2")).name).toBe("Portugal");
    const ana = await joinGroup({ code: pin }, "Ana", "ip2");
    expect(ana.view.role).toBe("editor");
    expect(ana.view.code).toBe(view.code);
    const rui = await joinGroup({ invite: view.invite }, "Rui", "ip3");
    expect(rui.view.members).toHaveLength(3);

    // Ana adds a cost while Tomás ticks a list: both stay.
    await changeGroup(view.id, ana.key, [{ t: "put", c: "expenses", item: { id: "x1", title: "Hotel", amount: 300, currency: "EUR", category: "stay", createdAt: "x" } }]);
    const after = (await changeGroup(view.id, ownerKey, [{ t: "put", c: "checklist", item: { id: "c1", list: "todo", text: "Insurance", createdAt: "x" } }])) as GroupView;
    expect(after.content.expenses).toHaveLength(1);
    expect(after.content.checklist).toHaveLength(1);
    expect(after.log.map((l) => l.by)).toContain("Ana");
    expect(after.log.map((l) => l.text)).toContain("added Hotel");
    const ticked = (await changeGroup(view.id, ana.key, [{ t: "put", c: "checklist", item: { id: "c1", list: "todo", text: "Insurance", done: true, createdAt: "x" } }])) as GroupView;
    expect(ticked.log.at(-1)?.text).toBe("ticked Insurance");

    // Nothing new since a version: a tiny answer.
    expect(await readGroup(view.id, rui.key, ticked.v)).toMatchObject({ same: true, v: ticked.v });
  });

  it("roles, new PIN, closing, leaving and stopping", async () => {
    const { key: owner, view } = await createGroup(content(), "Tomás", "ip1");
    const ana = await joinGroup({ invite: view.invite }, "Ana", "ip2");
    // Viewers see but can't change.
    await manageGroup(view.id, owner, { do: "role", member: ana.view.me, role: "viewer" });
    await expect(changeGroup(view.id, ana.key, [{ t: "set", f: "name", v: "Mine now" }])).rejects.toThrow(/can see this trip but not change/);
    const seen = (await readGroup(view.id, ana.key)) as GroupView;
    expect(seen.code).toBeUndefined();
    // Only the owner manages people.
    await expect(manageGroup(view.id, ana.key, { do: "remove", member: view.me })).rejects.toThrow(/Only the trip's owner/);
    // A new PIN: the old one stops working.
    const fresh = (await manageGroup(view.id, owner, { do: "new-pin" })) as GroupView;
    await expect(joinGroup({ code: view.code }, "Eve", "ip9")).rejects.toThrow(/doesn't lead to a trip/);
    // Closed: nobody joins, even with the right PIN.
    await manageGroup(view.id, owner, { do: "open", open: false });
    await expect(joinGroup({ code: fresh.code }, "Eve", "ip9")).rejects.toThrow(/closed/);
    // Taken out: their key no longer opens it.
    await manageGroup(view.id, owner, { do: "remove", member: ana.view.me });
    await expect(readGroup(view.id, ana.key)).rejects.toThrow(/not in this trip/);
    // Stopped: gone for everyone.
    await deleteGroup(view.id, owner);
    await expect(readGroup(view.id, owner)).rejects.toThrow(/isn't shared any more/);
  });

  it("PINs are typed any way and guessing is limited", async () => {
    expect(normalPin("k7qm 2xpa")).toBe("K7QM2XPA");
    expect(normalPin("K7QM-2XP")).toBe("");
    let blocked = false;
    for (let i = 0; i < 20; i++) {
      try {
        await joinGroup({ code: "AAAA-AAAA" }, "Guess", "ip-guess");
      } catch (err) {
        if (/going a bit fast/.test(String(err))) blocked = true;
      }
    }
    expect(blocked).toBe(true);
  });
});

describe("a cost typed in one line", () => {
  const who = [{ id: "ana", name: "Ana" }, { id: "rui", name: "Rui" }, { id: "eva", name: "Eva" }];
  it("amount, currency, kind and who paid, in English and Portuguese", () => {
    expect(parseExpense("Dinner at Ramiro 90€", who)).toEqual({ title: "Dinner at Ramiro", amount: 90, currency: "EUR", category: "food" });
    expect(parseExpense("taxi 12,50 paid by Ana", who)).toMatchObject({ title: "Taxi", amount: 12.5, currency: "EUR", category: "transport", paidBy: "ana" });
    expect(parseExpense("jantar 45 pago pela Eva", who)).toMatchObject({ title: "Jantar", amount: 45, category: "food", paidBy: "eva" });
    expect(parseExpense("Rui paid £30 museum", who)).toMatchObject({ amount: 30, currency: "GBP", paidBy: "rui", category: "activities" });
    expect(parseExpense("Hotel 2 nights $240", who)).toMatchObject({ title: "Hotel 2 nights", amount: 240, currency: "USD", category: "stay" });
  });
  it("who it's for", () => {
    expect(parseExpense("museu 30€ para a Eva e a Ana", who)).toMatchObject({ title: "Museu", amount: 30, split: ["eva", "ana"] });
    expect(parseExpense("snacks 8 for everyone", who)).toMatchObject({ title: "Snacks", amount: 8 });
    // A name that isn't a traveller stays in the title.
    expect(parseExpense("present for Mum 20", who)).toMatchObject({ title: "Present for Mum", amount: 20 });
  });
  it("no amount: nothing invented", () => {
    expect(parseExpense("souvenirs", who).amount).toBeUndefined();
  });
  it("a summary to send", () => {
    const c = { ...base(), currency: "EUR", expenses: [{ id: "x", title: "Hotel", amount: 300, currency: "EUR", category: "stay" as const, paidBy: "ana", createdAt: "x" }] };
    const text = moneyText(c, (n) => `€${n}`);
    expect(text).toContain("Portugal: €300");
    expect(text).toContain("Rui → Ana: €100");
  });
});

describe("presence and the trip's chat (server)", () => {
  beforeEach(() => resetMemory());
  it("shows who's here, signs messages, lets viewers talk but not edit", async () => {
    const { key: owner, view } = await createGroup({ ...base(), travellers: [] }, "Tomás", "ip1");
    const ana = await joinGroup({ invite: view.invite }, "Ana", "ip2");
    const r1 = (await readGroup(view.id, owner)) as GroupView;
    expect(r1.here).toEqual([view.me]);
    const r2 = (await readGroup(view.id, ana.key, r1.v)) as { here: string[] };
    expect(r2.here.sort()).toEqual([view.me, ana.view.me].sort());

    // Ana tries to post as Tomás: the server signs it as Ana.
    const after = await changeGroup(view.id, ana.key, [{ t: "put", c: "messages", item: { id: "m1", by: view.me, name: "Tomás", text: "Hotel booked!", at: "2000-01-01T00:00:00Z" } }]);
    expect(after.content.messages[0]).toMatchObject({ by: ana.view.me, name: "Ana", text: "Hotel booked!" });
    expect(after.content.messages[0].at).not.toBe("2000-01-01T00:00:00.000Z");
    // Nobody changes someone else's message.
    await expect(changeGroup(view.id, owner, [{ t: "put", c: "messages", item: { id: "m1", text: "edited", by: "x", name: "x", at: "x" } }])).rejects.toThrow(/your own messages/);
    // Messages don't fill the history.
    expect(after.log.some((l) => /message/.test(l.text))).toBe(false);

    // A viewer can talk, but not change the trip.
    await manageGroup(view.id, owner, { do: "role", member: ana.view.me, role: "viewer" });
    await changeGroup(view.id, ana.key, [{ t: "put", c: "messages", item: { id: "m2", text: "Can I add the museum?", by: "", name: "", at: "" } }]);
    await expect(changeGroup(view.id, ana.key, [{ t: "set", f: "budget", v: 10 }])).rejects.toThrow(/not change it/);
  });
});
