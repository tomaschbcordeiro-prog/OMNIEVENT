import { beforeEach, describe, expect, it, vi } from "vitest";
import { cmd, resetMemory } from "@/lib/community/kv";
import {
  changePassword, checkSafety, createPost, editPost, getMember, getNotices, getThread, hasPhone, memberOf, mentionsIn, react,
  reportPost, setPlan, signIn, signOutEverywhere, signUp, threadHead, toggleBlock, toggleFollow, toggleJoin,
} from "@/lib/community/service";

const A = "a".repeat(32);
const B = "b".repeat(32);
const C = "c".repeat(32);
const B2 = "x".repeat(32);
const T = "e:tm-9";
const meta = { target: T, title: "Gig", href: "/events/gig" };
const ids: Record<string, string> = {};

/** Accounts made "yesterday", so links are allowed unless a test says otherwise. */
async function member(secret: string, name: string, ageMs = 2 * 86400000) {
  const p = await signUp(secret, { firstName: name, lastName: "Teste", username: name.toLowerCase(), email: `${name.toLowerCase()}@example.com`, password: "três palavras juntas" }, `ip-${name}`);
  await cmd(["SET", `c:u:${p.id}`, JSON.stringify({ ...p, createdAt: new Date(Date.now() - ageMs).toISOString() })]);
  ids[secret] = p.id;
}

beforeEach(async () => {
  resetMemory();
  await member(A, "Ana");
  await member(B, "Bruno");
  await member(C, "Carla");
});

describe("what can be posted", () => {
  it("keeps contact details out of public posts", () => {
    for (const t of ["Text me 912 345 678", "call +351912345678", "ana@example.com for details", "add me on WhatsApp", "t.me/someone"]) expect(() => checkSafety(t), t).toThrow(/phone numbers, emails/);
    for (const t of ["Doors at 19:30 on 2026-10-31", "Tickets were 1 500 000 sold worldwide?", "Seasons 2025 2026 2027", "Gate 12, row 4"]) expect(() => checkSafety(t), t).not.toThrow();
    expect(hasPhone("(555) 123-4567")).toBe(true);
    expect(hasPhone("31/10/2026")).toBe(false);
  });
  it("refuses ticket selling and payment requests, not talk about sold-out shows", () => {
    for (const t of ["Selling 2 tickets, row A", "Vendo bilhetes para sábado", "pay me by MB Way", "Vendo entradas!"]) expect(() => checkSafety(t), t).toThrow(/tickets isn't allowed/);
    for (const t of ["Tickets are selling out fast", "Os bilhetes estão esgotados", "Where do I collect my tickets?"]) expect(() => checkSafety(t), t).not.toThrow();
  });
  it("refuses the same words twice in a day, and links on a member's first day", async () => {
    await createPost(A, { target: T, text: "See you at the front!" }, meta, "ip");
    await expect(createPost(A, { target: T, text: "see you at the front! " }, meta, "ip")).rejects.toThrow(/already posted/);
    await member(B2, "Novato", 3600000);
    await expect(createPost(B2, { target: T, text: "Look at https://example.com" }, meta, "ip")).rejects.toThrow(/first day/);
    await expect(createPost(A, { target: T, text: "Map: https://example.com/map" }, meta, "ip")).resolves.toBeTruthy();
  });
  it("checks edits too", async () => {
    const p = await createPost(A, { target: T, text: "Meet by the gate" }, meta, "ip");
    await expect(editPost(A, p.id, "Meet by the gate, call 912 345 678")).rejects.toThrow(/phone numbers/);
  });
});

describe("blocking", () => {
  it("hides a blocked member's posts and stops them reaching the blocker", async () => {
    const mine = await createPost(A, { target: T, kind: "meetup", text: "Meet at the main entrance at 8?" }, meta, "ip");
    await createPost(B, { target: T, text: "Anyone driving from Porto?" }, meta, "ip");
    await toggleFollow(B, ids[A]);
    expect((await toggleBlock(A, ids[B])).blocked).toBe(true);
    const t = await getThread(T, ids[A]);
    expect(t.posts.map((p) => p.author)).toEqual([ids[A]]);
    // Blocking ends following, and the blocked member can't come back in.
    expect((await getMember(ids[A]))!.follow.followers).toBe(0);
    await expect(toggleFollow(B, ids[A])).rejects.toThrow(/can't follow/);
    await expect(createPost(B, { target: T, text: "hey", parent: mine.id }, meta, "ip")).rejects.toThrow(/can't reply/);
    await expect(react(B, mine.id, "🔥")).rejects.toThrow(/can't react/);
    await expect(toggleJoin(B, mine.id)).rejects.toThrow(/can't join/);
    // Mentions from them don't arrive either, and their earlier notices disappear.
    await createPost(B, { target: T, text: "Hi @ana what time?" }, meta, "ip");
    expect((await getNotices(ids[A])).items.filter((n) => n.by === ids[B])).toHaveLength(0);
    // Others still see everything.
    expect((await getThread(T, ids[C])).posts).toHaveLength(3);
    expect((await toggleBlock(A, ids[B])).blocked).toBe(false);
  });
});

describe("reactions, mentions and meet-ups", () => {
  it("keeps one reaction per member, switchable, with one notice and points once", async () => {
    const p = await createPost(A, { target: T, text: "Brilliant support act tonight" }, meta, "ip");
    expect((await react(B, p.id, "🔥")).reactions).toEqual({ "🔥": 1 });
    expect((await react(C, p.id, "❤️")).reactions).toEqual({ "❤️": 1, "🔥": 1 });
    expect((await react(B, p.id, "❤️")).reactions).toEqual({ "❤️": 2 });
    const t = await getThread(T, ids[B]);
    expect(t.posts[0]).toMatchObject({ reactions: { "❤️": 2 }, myReaction: "❤️", likes: 2, liked: true });
    expect((await react(B, p.id, null)).reactions).toEqual({ "❤️": 1 });
    await expect(react(B, p.id, "💩")).rejects.toThrow(/reactions/);
    const n = await getNotices(ids[A]);
    expect(n.items.filter((x) => x.by === ids[B])).toHaveLength(1);
    expect(n.items.find((x) => x.by === ids[B])).toMatchObject({ type: "react", emoji: "🔥" });
  });
  it("tells mentioned members, once", async () => {
    expect(mentionsIn("hi @Ana and @bruno.x, not email@foo.com or @@x")).toEqual(["ana", "bruno.x"]);
    await createPost(B, { target: T, text: "@ana @ana are you going? @carla too" }, meta, "ip");
    expect((await getNotices(ids[A])).items.filter((x) => x.type === "mention")).toHaveLength(1);
    expect((await getNotices(ids[C])).items[0]).toMatchObject({ type: "mention", by: ids[B] });
  });
  it("lets people join a meet-up, and tells its author", async () => {
    const m = await createPost(A, { target: T, kind: "meetup", text: "Drinks at the kiosk before doors?" }, meta, "ip");
    expect(await toggleJoin(B, m.id)).toEqual({ joined: true, joins: 1 });
    expect(await toggleJoin(C, m.id)).toEqual({ joined: true, joins: 2 });
    await expect(toggleJoin(A, m.id)).rejects.toThrow(/your own/);
    const t = await getThread(T, ids[B]);
    expect(t.posts[0]).toMatchObject({ joins: 2, joined: true });
    expect(t.posts[0].joiners?.sort()).toEqual([ids[B], ids[C]].sort());
    expect((await getNotices(ids[A])).items.filter((x) => x.type === "join")).toHaveLength(2);
    expect(await toggleJoin(B, m.id)).toEqual({ joined: false, joins: 1 });
  });
  it("hides a post sooner when two people say it's a scam", async () => {
    const p = await createPost(A, { target: T, text: "Great night out everyone" }, meta, "ip");
    await expect(reportPost(A, p.id, "spam")).rejects.toThrow(/own post/);
    await reportPost(B, p.id, "scam");
    expect((await getThread(T)).posts).toHaveLength(1);
    await reportPost(C, p.id, "scam");
    expect((await getThread(T)).posts).toHaveLength(0);
  });
  it("answers a cheap head check for live updates", async () => {
    expect(await threadHead(T)).toEqual({ posts: 0, latest: null });
    const p = await createPost(A, { target: T, text: "First!" }, meta, "ip");
    await setPlan(B, T, "going", meta);
    expect(await threadHead(T)).toEqual({ posts: 1, latest: p.id });
  });
});

describe("account safety", () => {
  it("refuses easy passwords and ones made of the username", async () => {
    await expect(signUp("q".repeat(32), { firstName: "Q", lastName: "Q", username: "quim", email: "q@example.com", password: "password123" }, "ip9")).rejects.toThrow(/too easy/);
    await expect(signUp("q".repeat(32), { firstName: "Q", lastName: "Q", username: "quimzé", email: "q@example.com", password: "aaaaaaaaaa" }, "ip9")).rejects.toThrow();
    await expect(signUp("q".repeat(32), { firstName: "Q", lastName: "Q", username: "joaquim", email: "q@example.com", password: "joaquim2026!" }, "ip9")).rejects.toThrow(/username or email/);
  });
  it("signs out other devices when the password changes, and everywhere on request", async () => {
    const laptop = "l".repeat(32);
    const tablet = "t".repeat(32);
    await signIn(laptop, { login: "ana", password: "três palavras juntas" }, "ip1");
    await signIn(tablet, { login: "ana", password: "três palavras juntas" }, "ip1");
    expect(await memberOf(tablet)).toBe(ids[A]);
    await changePassword(laptop, { current: "três palavras juntas", next: "outra frase bem longa" }, "ip1");
    expect(await memberOf(laptop)).toBe(ids[A]);
    expect(await memberOf(tablet)).not.toBe(ids[A]);
    expect(await memberOf(A)).not.toBe(ids[A]);
    expect(await signOutEverywhere(laptop)).toBe(1);
    expect(await memberOf(laptop)).not.toBe(ids[A]);
  });
  it("takes as long to refuse an unknown login as a wrong password", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    const t0 = performance.now();
    await expect(signIn("u".repeat(32), { login: "nobody", password: "whatever words" }, "ip2")).rejects.toThrow(/Wrong/);
    const unknown = performance.now() - t0;
    const t1 = performance.now();
    await expect(signIn("u".repeat(32), { login: "ana", password: "whatever words" }, "ip2")).rejects.toThrow(/Wrong/);
    const wrong = performance.now() - t1;
    spy.mockRestore();
    expect(unknown).toBeGreaterThan(wrong * 0.4);
  });
});
