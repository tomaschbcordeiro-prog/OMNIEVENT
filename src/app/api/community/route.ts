import { ensureFresh, getCard } from "@/lib/store";
import { apiError, clientKey, handler, ok, rateLimit } from "@/lib/api";
import {
  CommunityError,
  createPost,
  deletePost,
  editPost,
  getHome,
  getMember,
  getThread,
  memberId,
  reportPost,
  saveProfile,
  setPlan,
  setRating,
  summaries,
  toggleLike,
  getProfile,
  trending,
  getNotices,
  unreadNotices,
  markNoticesSeen,
} from "@/lib/community/service";
import { resolveTarget } from "@/lib/community/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The member secret travels in a header, never in a URL. */
const secretOf = (req: Request) => req.headers.get("x-omni-member") ?? "";
const viewerOf = (req: Request) => {
  const s = secretOf(req);
  return s.length >= 20 ? memberId(s) : undefined;
};

function fail(err: unknown) {
  if (err instanceof CommunityError) return apiError(err.status, "community", err.message);
  throw err;
}

/**
 * GET /api/community?view=thread&target=e:<id>   conversation, ratings and plans
 * GET /api/community?view=home                   feed, trending, top rated, leaders
 * GET /api/community?view=member&id=<id>         a member's profile and posts
 * GET /api/community?view=me                     the caller's own profile and unread count
 * GET /api/community?view=notifications          replies and likes on the caller's posts
 * GET /api/community?view=summaries&targets=a,b  counts for cards
 * GET /api/community?view=buzz                   trending events as cards
 */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "home";
  if (!rateLimit(`community:${clientKey(req)}`, 240)) return apiError(429, "rate_limited", "Too many requests.");
  const viewer = viewerOf(req);
  try {
    if (view === "thread") {
      const target = url.searchParams.get("target") ?? "";
      await ensureFresh();
      return ok(await getThread(target, viewer, resolveTarget(target)));
    }
    if (view === "member") {
      const m = await getMember(url.searchParams.get("id") ?? "", viewer);
      return m ? ok(m) : apiError(404, "not_found", "No member with that id.");
    }
    if (view === "me") return ok({ profile: viewer ? (await getProfile(viewer)) ?? null : null, unread: viewer ? await unreadNotices(viewer) : 0 });
    if (view === "notifications") {
      if (!viewer) return apiError(401, "community", "Join the community first.");
      return ok(await getNotices(viewer));
    }
    if (view === "buzz") {
      // Events people are talking about or going to, as cards for the globe's lists.
      await ensureFresh();
      const targets = await trending(24, "e:");
      const sums = await summaries(targets);
      const items = targets
        .map((t) => {
          const c = getCard(t.slice(2));
          return c && Date.parse(c.start) > Date.now() - 12 * 3600000 ? { ...c, buzz: sums[t] } : null;
        })
        .filter(Boolean)
        .slice(0, 8);
      return ok({ items, total: items.length });
    }
    if (view === "summaries") return ok(await summaries((url.searchParams.get("targets") ?? "").split(",")));
    return ok(await getHome(viewer));
  } catch (err) {
    return fail(err);
  }
});

/** POST /api/community  { action, … } — every action needs the member secret header. */
export const POST = handler(async (req: Request) => {
  const ip = clientKey(req);
  if (!rateLimit(`community-w:${ip}`, 60)) return apiError(429, "rate_limited", "Too many requests.");
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError(400, "invalid_body", "Send JSON.");
  }
  const secret = secretOf(req);
  const target = String(body.target ?? "");
  const needMeta = async () => {
    await ensureFresh();
    const meta = resolveTarget(target);
    if (!meta) throw new CommunityError("We couldn't find that event or place. Reload the page and try again.", 404);
    return meta;
  };
  try {
    switch (body.action) {
      case "profile":
        if (secret.length < 20) throw new CommunityError("Missing member key.", 401);
        return ok({ profile: await saveProfile(secret, body, ip) });
      case "post":
        return ok({ post: await createPost(secret, { target, kind: body.kind, text: body.text, rating: body.rating, parent: body.parent }, await needMeta(), ip) });
      case "rate":
        await setRating(secret, target, body.rating, await needMeta());
        return ok({ ok: true });
      case "plan":
        await setPlan(secret, target, body.plan === "going" || body.plan === "interested" ? body.plan : "none", await needMeta());
        return ok({ ok: true });
      case "like":
        return ok(await toggleLike(secret, String(body.post ?? "")));
      case "edit":
        return ok({ post: await editPost(secret, String(body.post ?? ""), body.text) });
      case "delete":
        await deletePost(secret, String(body.post ?? ""));
        return ok({ ok: true });
      case "seen":
        await markNoticesSeen(secret);
        return ok({ ok: true });
      case "report":
        await reportPost(secret, String(body.post ?? ""));
        return ok({ ok: true });
      default:
        return apiError(400, "unknown_action", "Unknown action.");
    }
  } catch (err) {
    return fail(err);
  }
});
