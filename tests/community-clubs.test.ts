import { beforeEach, describe, expect, it } from "vitest";
import { cmd, resetMemory } from "@/lib/community/kv";
import { createPost, getNotices, getProfile, getThread, memberOf, signUp } from "@/lib/community/service";
import {
  addPick, answerRequest, createClub, deleteClub, getClub, getClubDirectory, joinClub, leaveClub, moderateWall, myClubs,
  removeMember, removePick, setClubRole, tasteOf, transferClub, updateClub, votePick, wallAccess, wallOf,
} from "@/lib/community/clubs";
import type { EventCard } from "@/lib/types";

const A = "a".repeat(32);
const B = "b".repeat(32);
const C = "c".repeat(32);
const ids: Record<string, string> = {};

async function member(secret: string, name: string) {
  const p = await signUp(secret, { firstName: name, lastName: "Teste", username: name.toLowerCase(), email: `${name.toLowerCase()}@example.com`, password: "três palavras juntas" }, `ip-${name}`);
  // Accounts made "yesterday", so links in posts are allowed.
  await cmd(["SET", `c:u:${p.id}`, JSON.stringify({ ...p, createdAt: new Date(Date.now() - 2 * 86400000).toISOString() })]);
  ids[secret] = p.id;
}

const club = (o: Record<string, unknown> = {}) => ({ name: "Lisbon Jazz Nights", tagline: "Small clubs, big solos, every week", emoji: "🎷", hue: 270, vibes: ["music", "nightlife", "nope"], tags: ["Jazz", "late shows", "x"], cityId: "lisbon", privacy: "open", ...o });

const event = (o: Partial<EventCard> = {}): EventCard =>
  ({
    id: "tm-1", slug: "sax-night", title: "Sax Night", categorySlug: "jazz", groupSlug: "music", start: new Date(Date.now() + 3 * 86400000).toISOString(), timeZone: "Europe/Lisbon",
    status: "scheduled", ticketAccess: "ticketed", isFree: false, familyFriendly: false, online: false, venueName: "Hot Clube", venueSlug: "hot-clube", city: "Lisbon",
    country: "Portugal", lat: 38.7, lng: -9.1, people: [], providers: [], isDemo: false, provider: "test", lastSyncedAt: "", eventType: "single", ...o,
  }) as EventCard;

beforeEach(async () => {
  resetMemory();
  await member(A, "Ana");
  await member(B, "Bruno");
  await member(C, "Carla");
});

describe("founding a club", () => {
  it("makes the founder its owner, with a clean address, vibes and tags", async () => {
    const c = await createClub(A, club(), "ip-a");
    expect(c).toMatchObject({ slug: "lisbon-jazz-nights", owner: ids[A], vibes: ["music", "nightlife"], tags: ["jazz", "late shows"], city: "Lisbon", privacy: "open" });
    const page = (await getClub("lisbon-jazz-nights", ids[A]))!;
    expect(page.club).toMatchObject({ members: 1, myRole: "owner" });
    expect((await getProfile(ids[A]))!.badges).toContain("founder");
    // A second club with the same name gets its own address.
    expect((await createClub(B, club(), "ip-b")).slug).toBe("lisbon-jazz-nights-2");
  });
  it("refuses official-sounding names, contact details and a fourth club", async () => {
    await expect(createClub(A, club({ name: "OMNIEVENT Official" }), "ip-a")).rejects.toThrow(/official/);
    await expect(createClub(A, club({ tagline: "Call 912 345 678 to join" }), "ip-a")).rejects.toThrow(/phone numbers/);
    await createClub(A, club({ name: "One club" }), "ip-a");
    await createClub(A, club({ name: "Two club" }), "ip-a");
    await createClub(A, club({ name: "Three club" }), "ip-a");
    await expect(createClub(A, club({ name: "Four club" }), "ip-a")).rejects.toThrow(/up to 3/);
  });
  it("needs an account", async () => {
    await expect(createClub("z".repeat(32), club(), "ip-z")).rejects.toThrow(/sign in/i);
  });
});

describe("members and roles", () => {
  it("lets anyone join an open club and tells the owner", async () => {
    const c = await createClub(A, club(), "ip-a");
    expect(await joinClub(B, c.id)).toEqual({ status: "joined", members: 2 });
    expect((await getNotices(ids[A])).items[0]).toMatchObject({ type: "club", by: ids[B], text: "joined" });
    const dir = await getClubDirectory(ids[B]);
    expect(dir.mine.map((x) => x.id)).toEqual([c.id]);
    expect(dir.popular[0]).toMatchObject({ members: 2 });
    expect((await myClubs(B)).map((x) => x.slug)).toEqual([c.slug]);
  });
  it("keeps a request-only club's wall, members and picks to its members, until a request is accepted", async () => {
    const c = await createClub(A, club({ privacy: "request" }), "ip-a");
    expect(await joinClub(B, c.id)).toMatchObject({ status: "requested" });
    const outside = (await getClub(c.slug, ids[B]))!;
    expect(outside).toMatchObject({ inside: false, members: [], picks: [], club: { requested: true, members: 1 } });
    expect((await wallAccess(wallOf(c.id), ids[B])).read).toBe(false);
    // The owner sees the request and lets them in.
    expect((await getClub(c.slug, ids[A]))!.requests.map((r) => r.profile.id)).toEqual([ids[B]]);
    await answerRequest(A, c.id, ids[B], true);
    expect((await getNotices(ids[B])).items[0]).toMatchObject({ type: "club", text: "let you into" });
    expect((await getClub(c.slug, ids[B]))!).toMatchObject({ inside: true, club: { myRole: "member", members: 2 } });
    // Turning a request down.
    await joinClub(C, c.id);
    await answerRequest(A, c.id, ids[C], false);
    expect((await getClub(c.slug, ids[A]))!.requests).toEqual([]);
  });
  it("gives the owner admins, and admins limited powers", async () => {
    const c = await createClub(A, club(), "ip-a");
    await joinClub(B, c.id);
    await joinClub(C, c.id);
    await expect(setClubRole(B, c.id, ids[C], "admin")).rejects.toThrow(/owner or admins/);
    await setClubRole(A, c.id, ids[B], "admin");
    expect((await getNotices(ids[B])).items[0]).toMatchObject({ text: "made you an admin of" });
    // An admin edits the club and removes a member, but not the owner.
    expect((await updateClub(B, c.id, { tagline: "Every Thursday, front row" })).tagline).toBe("Every Thursday, front row");
    await expect(removeMember(B, c.id, ids[A])).rejects.toThrow(/can't remove/);
    await removeMember(B, c.id, ids[C], true);
    expect((await getClub(c.slug, ids[A]))!.members.map((m) => m.role)).toEqual(["owner", "admin"]);
    // Removed with a ban: no way back in.
    await expect(joinClub(C, c.id)).rejects.toThrow(/removed you/);
  });
  it("hands the club over; the owner can't just leave", async () => {
    const c = await createClub(A, club(), "ip-a");
    await joinClub(B, c.id);
    await expect(leaveClub(A, c.id)).rejects.toThrow(/make someone else the owner/);
    await transferClub(A, c.id, ids[B]);
    const page = (await getClub(c.slug, ids[A]))!;
    expect(page.club).toMatchObject({ owner: ids[B], myRole: "admin" });
    await leaveClub(A, c.id);
    expect((await getClub(c.slug, ids[A]))!.club).toMatchObject({ members: 1, myRole: undefined });
  });
  it("closes for good when the owner deletes it", async () => {
    const c = await createClub(A, club(), "ip-a");
    await joinClub(B, c.id);
    await expect(deleteClub(B, c.id)).rejects.toThrow(/owner/);
    await deleteClub(A, c.id);
    expect(await getClub(c.slug, ids[A])).toBeUndefined();
    expect((await getClubDirectory(ids[B])).mine).toEqual([]);
    expect((await getProfile(ids[A]))!.counts.founded).toBe(0);
  });
});

describe("the wall", () => {
  it("is for members to post on, stays out of the community feed, and admins can clean it", async () => {
    const c = await createClub(A, club(), "ip-a");
    const meta = { target: wallOf(c.id), title: c.name, href: `/clubs/${c.slug}` };
    expect((await wallAccess(wallOf(c.id), ids[B])).post).toBe(false);
    await joinClub(B, c.id);
    expect((await wallAccess(wallOf(c.id), ids[B])).post).toBe(true);
    const post = await createPost(B, { target: wallOf(c.id), kind: "comment", text: "Who's in for Thursday?" }, meta, "ip-b");
    expect((await getThread(wallOf(c.id), ids[A])).posts.map((p) => p.id)).toEqual([post.id]);
    expect(await cmd(["ZREVRANGE", "c:feed", 0, 5])).toEqual([]);
    await expect(moderateWall(C, c.id, post.id)).rejects.toThrow(/Join the club|owner or admins/);
    await moderateWall(A, c.id, post.id);
    expect((await getThread(wallOf(c.id), ids[A])).posts).toEqual([]);
  });
});

describe("picks and taste", () => {
  it("lets members share upcoming events and vote for them", async () => {
    const c = await createClub(A, club(), "ip-a");
    await joinClub(B, c.id);
    await expect(addPick(C, c.id, event())).rejects.toThrow(/Join the club/);
    await expect(addPick(A, c.id, event({ start: "2020-01-01T20:00:00Z" }))).rejects.toThrow(/still to come/);
    expect(await addPick(A, c.id, event())).toMatchObject({ id: "tm-1", votes: 1, voted: true, by: ids[A] });
    await addPick(B, c.id, event({ id: "tm-2", slug: "film", title: "Film", groupSlug: "cinema", categorySlug: "cinema" }));
    expect(await votePick(B, c.id, "tm-1")).toEqual({ votes: 2, voted: true });
    const page = (await getClub(c.slug, ids[B]))!;
    expect(page.picks.map((p) => [p.id, p.votes, p.voted])).toEqual([["tm-1", 2, true], ["tm-2", 1, true]]);
    expect(await votePick(B, c.id, "tm-1")).toEqual({ votes: 1, voted: false });
    // Only who shared it, or an admin, removes a pick.
    await expect(removePick(B, c.id, "tm-1")).rejects.toThrow(/Only who shared it/);
    await removePick(A, c.id, "tm-2");
    expect((await getClub(c.slug, ids[A]))!.picks.map((p) => p.id)).toEqual(["tm-1"]);
  });
  it("works out what a club is into from its vibes and picks", () => {
    expect(tasteOf({ vibes: ["music"] }, [{ groupSlug: "music" }, { groupSlug: "cinema" }])).toEqual([
      { group: "music", share: 80 },
      { group: "cinema", share: 20 },
    ]);
    expect(tasteOf({ vibes: [] }, [])).toEqual([]);
  });
});

describe("addresses", () => {
  it("are found again by their slug, and the member is who they say", async () => {
    const c = await createClub(A, club({ name: "Fado & Friends" }), "ip-a");
    expect(c.slug).toBe("fado-friends");
    expect((await getClub("Fado-Friends", await memberOf(A)))!.club.id).toBe(c.id);
  });
});
