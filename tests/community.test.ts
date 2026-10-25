import { beforeEach, describe, expect, it } from "vitest";
import { resetMemory } from "@/lib/community/kv";
import { cleanName, cleanText, createPost, deletePost, getHome, getMember, getThread, memberId, reportPost, saveProfile, setPlan, setRating, toggleLike } from "@/lib/community/service";

const A = "a".repeat(32);
const B = "b".repeat(32);
const C = "c".repeat(32);
const D = "d".repeat(32);
const T = "e:tm-123";
const meta = { target: T, title: "Test gig", href: "/events/test-gig" };

beforeEach(async () => {
  resetMemory();
  for (const [s, n] of [[A, "Ana"], [B, "Bruno"], [C, "Carla"], [D, "Duda"]]) await saveProfile(s, { name: n, avatar: "🦊" }, "1.1.1.1");
});

describe("community", () => {
  it("validates names and text", () => {
    expect(cleanName("  Sunny   Otter ")).toBe("Sunny Otter");
    expect(() => cleanName("x")).toThrow();
    expect(() => cleanName("<script>")).toThrow();
    expect(cleanText("hi\n\n\n\nthere")).toBe("hi\n\nthere");
    expect(() => cleanText("a")).toThrow();
    expect(() => cleanText("http://a http://b http://c")).toThrow();
  });

  it("requires a profile to post", async () => {
    await expect(createPost("z".repeat(32), { target: T, text: "hello" }, meta, "ip")).rejects.toThrow(/Join/);
  });

  it("threads replies, likes and plans", async () => {
    const p = await createPost(A, { target: T, kind: "question", text: "Which door opens first?" }, meta, "ip");
    const r = await createPost(B, { target: T, text: "Gate B usually", parent: p.id }, meta, "ip");
    // A reply to a reply attaches to the top post.
    await createPost(C, { target: T, text: "Thanks!", parent: r.id }, meta, "ip");
    expect(await toggleLike(B, p.id)).toEqual({ liked: true, likes: 1 });
    await setPlan(A, T, "going", meta);
    await setPlan(B, T, "interested", meta);
    await setPlan(B, T, "going", meta);
    const t = await getThread(T, memberId(B));
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0].replies).toHaveLength(2);
    expect(t.posts[0].liked).toBe(true);
    expect(t.summary).toMatchObject({ going: 2, interested: 0, posts: 3 });
    expect(t.me).toMatchObject({ going: true, interested: false });
    expect(t.profiles[memberId(A)].badges).toContain("voice");
    expect((await getProfileKarma(A))).toBeGreaterThan(5);
  });

  it("averages ratings, one per member", async () => {
    await createPost(A, { target: T, kind: "review", rating: 5, text: "Brilliant night" }, meta, "ip");
    await setRating(A, T, 4, meta);
    await setRating(B, T, 2, meta);
    const t = await getThread(T);
    expect(t.summary.ratingCount).toBe(2);
    expect(t.summary.ratingAvg).toBe(3);
    expect(t.ratingDist).toEqual([0, 1, 0, 1, 0]);
    const home = await getHome();
    expect(home.topRated[0]).toMatchObject({ title: "Test gig", ratingCount: 2 });
    expect(home.stats).toMatchObject({ members: 4, ratings: 2, posts: 1 });
  });

  it("hides posts after three reports and lets authors delete", async () => {
    const p = await createPost(A, { target: T, text: "spam spam" }, meta, "ip");
    await reportPost(B, p.id);
    await reportPost(C, p.id);
    expect((await getThread(T)).posts).toHaveLength(1);
    await reportPost(D, p.id);
    expect((await getThread(T)).posts).toHaveLength(0);
    const q = await createPost(A, { target: T, text: "second try" }, meta, "ip");
    await expect(deletePost(B, q.id)).rejects.toThrow(/own/);
    await deletePost(A, q.id);
    expect((await getThread(T)).posts).toHaveLength(0);
    // Hidden and deleted posts leave the profile too.
    expect((await getMember(memberId(A)))!.posts).toHaveLength(0);
  });

  it("rate-limits bursts", async () => {
    for (let i = 0; i < 8; i++) await createPost(A, { target: T, text: `post ${i}` }, meta, "ip");
    await expect(createPost(A, { target: T, text: "one more" }, meta, "ip")).rejects.toThrow(/fast/);
  });
});

async function getProfileKarma(secret: string) {
  return (await getMember(memberId(secret)))!.profile.karma;
}
