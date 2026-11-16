import { apiError, clientKey, handler, ok, rateLimit, readJson } from "@/lib/api";
import { CommunityError, memberOf } from "@/lib/community/service";
import { getSharedTrip, likeSharedTrip, listSharedTrips, mySharedTrips, reportSharedTrip, shareTrip, unshareTrip, usedSharedTrip } from "@/lib/community/shared-trips";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The member secret travels in a header, never in a URL. */
const secretOf = (req: Request) => req.headers.get("x-omni-member") ?? "";

function fail(err: unknown) {
  if (err instanceof CommunityError) return apiError(err.status, "community", err.message);
  if (String((err as Error)?.message).startsWith("community storage")) return apiError(503, "storage_unavailable", "Shared trips are taking a short break: storage isn't answering. Please try again later.");
  throw err;
}

/**
 * GET /api/shared-trips?sort=top|new&offset=&limit=   trips people shared
 * GET /api/shared-trips?id=<id>                       one of them
 * GET /api/shared-trips?view=mine                     the caller's own
 */
export const GET = handler(async (req: Request) => {
  if (!rateLimit(`st:${clientKey(req)}`, 240)) return apiError(429, "rate_limited", "Too many requests.");
  const url = new URL(req.url);
  try {
    if (url.searchParams.get("view") === "mine") return ok({ trips: await mySharedTrips(secretOf(req)) });
    const viewer = await memberOf(secretOf(req));
    const id = url.searchParams.get("id");
    if (id) {
      const trip = await getSharedTrip(id, viewer);
      return trip && (!trip.hidden || trip.mine) ? ok({ trip }) : apiError(404, "not_found", "That shared trip is gone.");
    }
    const sort = url.searchParams.get("sort") === "new" ? "new" : "top";
    return ok(await listSharedTrips({ sort, offset: Number(url.searchParams.get("offset") ?? 0), limit: Number(url.searchParams.get("limit") ?? 24), viewer }));
  } catch (err) {
    return fail(err);
  }
});

/**
 * POST /api/shared-trips { action, … }
 * share { id?, name, emoji, about, month?, stops[] } · unshare { id } · like { id } · use { id } · report { id }
 */
export const POST = handler(async (req: Request) => {
  const ip = clientKey(req);
  if (!rateLimit(`st-w:${ip}`, 60)) return apiError(429, "rate_limited", "Too many requests.");
  const body = await readJson(req, 32 * 1024);
  if (body instanceof Response) return body;
  const secret = secretOf(req);
  try {
    switch (body.action) {
      case "share":
        return ok({ trip: await shareTrip(secret, body) });
      case "unshare":
        await unshareTrip(secret, body.id);
        return ok({ ok: true });
      case "like":
        return ok(await likeSharedTrip(secret, body.id));
      case "use":
        await usedSharedTrip(body.id, (await memberOf(secret)) ?? ip);
        return ok({ ok: true });
      case "report":
        await reportSharedTrip(secret, body.id);
        return ok({ ok: true });
      default:
        return apiError(400, "unknown_action", "Unknown action.");
    }
  } catch (err) {
    return fail(err);
  }
});
