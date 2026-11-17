import { apiError, clientKey, handler, ok, rateLimit, readJson } from "@/lib/api";
import { CommunityError } from "@/lib/community/service";
import { changeGroup, createGroup, deleteGroup, joinGroup, manageGroup, peekGroup, readGroup } from "@/lib/group-trips";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A member's key travels in a header, never in a URL. */
const keyOf = (req: Request) => req.headers.get("x-trip-key") ?? "";

function fail(err: unknown) {
  if (err instanceof CommunityError) return apiError(err.status, "trip", err.message);
  if (String((err as Error)?.message).startsWith("community storage")) return apiError(503, "storage_unavailable", "Shared trips are taking a short break: storage isn't answering. Your changes are kept on this device and will be sent later.");
  throw err;
}

/** GET /api/group-trips?id=<id>&since=<version>   the trip, for one of its members ({ same } when unchanged) */
export const GET = handler(async (req: Request) => {
  if (!rateLimit(`gt:${clientKey(req)}`, 600)) return apiError(429, "rate_limited", "Too many requests.");
  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since"));
  try {
    const res = ok(await readGroup(url.searchParams.get("id") ?? "", keyOf(req), Number.isFinite(since) && since > 0 ? since : undefined));
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (err) {
    return fail(err);
  }
});

/**
 * POST /api/group-trips { action, … }
 * create { content, name } · peek { invite | code } · join { invite | code, name }
 * change { id, ops } · manage { id, do, … } · stop { id }
 */
export const POST = handler(async (req: Request) => {
  const ip = clientKey(req);
  if (!rateLimit(`gt-w:${ip}`, 240)) return apiError(429, "rate_limited", "Too many requests.");
  const body = await readJson(req, 700 * 1024);
  if (body instanceof Response) return body;
  const key = keyOf(req);
  const id = typeof body.id === "string" ? body.id : "";
  try {
    let res: Response;
    switch (body.action) {
      case "create":
        res = ok(await createGroup(body.content, body.name, ip));
        break;
      case "peek":
        res = ok({ trip: await peekGroup({ invite: body.invite, code: body.code }, ip) });
        break;
      case "join":
        res = ok(await joinGroup({ invite: body.invite, code: body.code }, body.name, ip));
        break;
      case "change":
        res = ok({ view: await changeGroup(id, key, body.ops) });
        break;
      case "manage":
        res = ok({ view: await manageGroup(id, key, body) });
        break;
      case "stop":
        res = ok(await deleteGroup(id, key));
        break;
      default:
        return apiError(400, "invalid_action", "Unknown action.");
    }
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (err) {
    return fail(err);
  }
});
