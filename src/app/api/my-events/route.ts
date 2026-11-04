import { refreshSource } from "@/lib/store";
import { apiError, clientKey, handler, ok, rateLimit } from "@/lib/api";
import { CommunityError } from "@/lib/community/service";
import { PROVIDER_ID, createUserEvent, deleteUserEvent, editableUserEvent, myUserEvents, reportUserEvent, setCancelled, updateUserEvent } from "@/lib/user-events";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The member secret travels in a header, never in a URL. */
const secretOf = (req: Request) => req.headers.get("x-omni-member") ?? "";

function fail(err: unknown) {
  if (err instanceof CommunityError) return apiError(err.status, "listing", err.message);
  if (String((err as Error)?.message).startsWith("community storage"))
    return apiError(503, "storage_unavailable", "Listing events is taking a short break: our storage isn't answering right now. Your draft is kept on this device, so try again in a little while.");
  throw err;
}

/**
 * GET /api/my-events              the caller's listed events
 * GET /api/my-events?id=<id>      one of them, as entered (to edit)
 */
export const GET = handler(async (req: Request) => {
  if (!rateLimit(`my-events:${clientKey(req)}`, 120)) return apiError(429, "rate_limited", "Too many requests.");
  const id = new URL(req.url).searchParams.get("id");
  try {
    return ok(id ? { event: await editableUserEvent(secretOf(req), id) } : { events: await myUserEvents(secretOf(req)) });
  } catch (err) {
    return fail(err);
  }
});

/**
 * POST /api/my-events { action, … }
 * create { event } · update { id, event } · cancel { id } · restore { id } · delete { id } · report { id }
 */
export const POST = handler(async (req: Request) => {
  const ip = clientKey(req);
  if (!rateLimit(`my-events-w:${ip}`, 40)) return apiError(429, "rate_limited", "Too many requests.");
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError(400, "invalid_body", "Send JSON.");
  }
  const secret = secretOf(req);
  try {
    let result: unknown;
    switch (body.action) {
      case "create":
        result = await createUserEvent(secret, body.event, ip);
        break;
      case "update":
        result = await updateUserEvent(secret, body.id, body.event);
        break;
      case "cancel":
      case "restore":
        result = await setCancelled(secret, body.id, body.action === "cancel");
        break;
      case "delete":
        result = await deleteUserEvent(secret, body.id);
        break;
      case "report":
        return ok(await reportUserEvent(secret, body.id));
      default:
        return apiError(400, "unknown_action", "Unknown action.");
    }
    // This server shows the change at once; the others pick it up within a minute.
    await refreshSource(PROVIDER_ID).catch(() => {});
    return ok(result);
  } catch (err) {
    return fail(err);
  }
});
