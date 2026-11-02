import { ensureFresh, getCard } from "@/lib/store";
import { apiError, clientKey, handler, ok, rateLimit } from "@/lib/api";
import { CommunityError, memberOf } from "@/lib/community/service";
import {
  addPick,
  answerRequest,
  createClub,
  deleteClub,
  getClub,
  getClubDirectory,
  joinClub,
  leaveClub,
  moderateWall,
  myClubs,
  removeMember,
  removePick,
  setClubRole,
  transferClub,
  updateClub,
  votePick,
} from "@/lib/community/clubs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The member secret travels in a header, never in a URL. */
const secretOf = (req: Request) => req.headers.get("x-omni-member") ?? "";

function fail(err: unknown) {
  if (err instanceof CommunityError) return apiError(err.status, "community", err.message);
  if (String((err as Error)?.message).startsWith("community storage")) return apiError(503, "storage_unavailable", "Clubs are taking a short break: storage isn't answering right now. Please try again later.");
  throw err;
}

/**
 * GET /api/clubs                    the clubs directory (yours, biggest, newest)
 * GET /api/clubs?slug=<slug>        a club's page
 * GET /api/clubs?view=mine          the clubs the caller is in (for "share with a club")
 */
export const GET = handler(async (req: Request) => {
  if (!rateLimit(`clubs:${clientKey(req)}`, 240)) return apiError(429, "rate_limited", "Too many requests.");
  const url = new URL(req.url);
  try {
    if (url.searchParams.get("view") === "mine") return ok({ clubs: await myClubs(secretOf(req)) });
    const viewer = await memberOf(secretOf(req));
    const slug = url.searchParams.get("slug");
    if (slug) {
      const page = await getClub(slug, viewer);
      return page ? ok(page) : apiError(404, "not_found", "No club with that address.");
    }
    return ok(await getClubDirectory(viewer));
  } catch (err) {
    return fail(err);
  }
});

/**
 * POST /api/clubs { action, club?, … }
 * create { name, tagline, about?, emoji, hue, vibes[], tags[], cityId?, privacy } · update { club, …fields } ·
 * delete { club } · join { club } · leave { club } · accept / decline { club, member } ·
 * remove { club, member, ban? } · role { club, member, role: "admin" | "member" } ·
 * transfer { club, member } · unpost { club, post } · pick { club, event } · vote { club, event } ·
 * unpick { club, event }
 */
export const POST = handler(async (req: Request) => {
  const ip = clientKey(req);
  if (!rateLimit(`clubs-w:${ip}`, 60)) return apiError(429, "rate_limited", "Too many requests.");
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError(400, "invalid_body", "Send JSON.");
  }
  const secret = secretOf(req);
  try {
    switch (body.action) {
      case "create":
        return ok({ club: await createClub(secret, body, ip) });
      case "update":
        return ok({ club: await updateClub(secret, body.club, body) });
      case "delete":
        await deleteClub(secret, body.club);
        return ok({ ok: true });
      case "join":
        return ok(await joinClub(secret, body.club));
      case "leave":
        await leaveClub(secret, body.club);
        return ok({ ok: true });
      case "accept":
      case "decline":
        await answerRequest(secret, body.club, body.member, body.action === "accept");
        return ok({ ok: true });
      case "remove":
        await removeMember(secret, body.club, body.member, body.ban === true);
        return ok({ ok: true });
      case "role":
        await setClubRole(secret, body.club, body.member, body.role);
        return ok({ ok: true });
      case "transfer":
        await transferClub(secret, body.club, body.member);
        return ok({ ok: true });
      case "unpost":
        await moderateWall(secret, body.club, body.post);
        return ok({ ok: true });
      case "pick": {
        // The event is read from our own catalogue, never from what the browser says about it.
        await ensureFresh();
        return ok({ pick: await addPick(secret, body.club, getCard(String(body.event ?? ""))) });
      }
      case "vote":
        return ok(await votePick(secret, body.club, body.event));
      case "unpick":
        await removePick(secret, body.club, body.event);
        return ok({ ok: true });
      default:
        return apiError(400, "unknown_action", "Unknown action.");
    }
  } catch (err) {
    return fail(err);
  }
});
