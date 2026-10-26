import { beforeEach, describe, expect, it } from "vitest";
import { cmd, resetMemory } from "@/lib/community/kv";
import { accountInfo, changePassword, cleanEmail, cleanUsername, createPost, idForUsername, memberId, memberOf, saveProfile, signIn, signOut, signUp } from "@/lib/community/service";

const phone = "p".repeat(32);
const laptop = "l".repeat(32);
const other = "o".repeat(32);
const T = "e:tm-1";
const meta = { target: T, title: "Gig", href: "/events/gig" };
const maria = { firstName: "Maria", lastName: "Costa", username: "maria.costa", email: "Maria@Example.com", password: "fado-e-sardinhas" };

beforeEach(() => resetMemory());

describe("accounts", () => {
  it("creates an account with first and last name, username and email", async () => {
    const p = await signUp(phone, maria, "ip1");
    expect(p).toMatchObject({ name: "Maria Costa", username: "maria.costa" });
    expect(await accountInfo(p.id)).toEqual({ email: "maria@example.com", username: "maria.costa", firstName: "Maria", lastName: "Costa" });
    expect(await idForUsername("@Maria.Costa")).toBe(p.id);
    // The password itself is never stored.
    expect(JSON.stringify(await cmd(["GET", `c:acct:${p.id}`]))).not.toContain("fado-e-sardinhas");
  });

  it("keeps usernames and emails unique", async () => {
    await signUp(phone, maria, "ip1");
    await expect(signUp(other, { ...maria, email: "other@example.com" }, "ip2")).rejects.toThrow(/username is taken/);
    await expect(signUp(other, { ...maria, username: "maria2" }, "ip2")).rejects.toThrow(/already an account/);
    // The username claimed by the failed attempt is released.
    expect(await idForUsername("maria2")).toBeUndefined();
  });

  it("signs in on another device as the same member, and out again", async () => {
    const p = await signUp(phone, maria, "ip1");
    await expect(signIn(laptop, { login: "maria@example.com", password: "wrong password" }, "ip3")).rejects.toThrow(/Wrong/);
    expect(await memberOf(laptop)).not.toBe(p.id);
    expect((await signIn(laptop, { login: "@maria.costa", password: "fado-e-sardinhas" }, "ip3")).id).toBe(p.id);
    expect(await memberOf(laptop)).toBe(p.id);
    const post = await createPost(laptop, { target: T, text: "Posted from the laptop" }, meta, "ip3");
    expect(post.author).toBe(p.id);
    await signOut(laptop);
    await expect(createPost(laptop, { target: T, text: "After signing out" }, meta, "ip3")).rejects.toThrow(/account/);
    // The phone stays signed in.
    expect(await memberOf(phone)).toBe(p.id);
  });

  it("turns a profile made before accounts into an account, keeping its id", async () => {
    const legacyId = memberId(other);
    await cmd(["SET", `c:u:${legacyId}`, JSON.stringify({ id: legacyId, name: "Sunny Otter", avatar: "🦊", hue: 200, createdAt: "2026-10-01T00:00:00Z" })]);
    await expect(createPost(other, { target: T, text: "hello there" }, meta, "ip")).rejects.toThrow(/Finish creating/);
    const p = await signUp(other, { ...maria, username: "sunny", email: "sunny@example.com" }, "ip");
    expect(p).toMatchObject({ id: legacyId, name: "Maria Costa", avatar: "🦊", createdAt: "2026-10-01T00:00:00Z" });
    expect((await createPost(other, { target: T, text: "hello there" }, meta, "ip")).author).toBe(legacyId);
  });

  it("edits the profile, username and email, and changes the password", async () => {
    const p = await signUp(phone, maria, "ip1");
    await signUp(other, { ...maria, username: "taken", email: "taken@example.com" }, "ip2");
    await expect(saveProfile(phone, { username: "taken" }, "ip1")).rejects.toThrow(/taken/);
    const edited = await saveProfile(phone, { firstName: "Maria João", username: "mjc", email: "mj@example.com", bio: "Fado lover" }, "ip1");
    expect(edited).toMatchObject({ name: "Maria João Costa", username: "mjc", bio: "Fado lover" });
    expect(await idForUsername("maria.costa")).toBeUndefined();
    expect(await idForUsername("mjc")).toBe(p.id);
    await expect(changePassword(phone, { current: "nope nope", next: "new password 1" }, "ip1")).rejects.toThrow(/current password/);
    await changePassword(phone, { current: "fado-e-sardinhas", next: "new password 1" }, "ip1");
    expect((await signIn(laptop, { login: "mj@example.com", password: "new password 1" }, "ip3")).id).toBe(p.id);
  });

  it("validates usernames, emails and passwords", async () => {
    expect(cleanUsername("@Ana_Silva")).toBe("ana_silva");
    expect(() => cleanUsername("ab")).toThrow();
    expect(() => cleanUsername("admin")).toThrow(/reserved/);
    expect(() => cleanUsername("ana silva")).toThrow();
    expect(cleanEmail(" Ana@Mail.PT ")).toBe("ana@mail.pt");
    expect(() => cleanEmail("ana@mail")).toThrow();
    await expect(signUp(phone, { ...maria, password: "short" }, "ip")).rejects.toThrow(/8 characters/);
    await expect(signUp(phone, { ...maria, firstName: "<b>" }, "ip")).rejects.toThrow(/First name/);
  });
});

describe("deleting an account", () => {
  it("removes the account and frees its username and email", async () => {
    const { deleteAccount, getProfile, setPlan } = await import("@/lib/community/service");
    const p = await signUp(phone, maria, "ip1");
    await setPlan(phone, T, "going", meta);
    await expect(deleteAccount(phone, { password: "nope nope" })).rejects.toThrow(/password/);
    await deleteAccount(phone, { password: "fado-e-sardinhas" });
    expect(await getProfile(p.id)).toBeUndefined();
    expect(await idForUsername("maria.costa")).toBeUndefined();
    expect(await cmd(["SISMEMBER", `c:go:${T}`, p.id])).toBe(0);
    await expect(signIn(laptop, { login: "maria.costa", password: "fado-e-sardinhas" }, "ip3")).rejects.toThrow(/Wrong/);
    // The username and email can be used again.
    expect((await signUp(other, maria, "ip2")).username).toBe("maria.costa");
  });
});
