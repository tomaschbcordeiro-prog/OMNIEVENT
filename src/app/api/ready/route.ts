import { catalogueComplete, dataSummary, ensureFresh } from "@/lib/store";

export const dynamic = "force-dynamic";
// A new server's loading keeps going after the answer (after()) for up to this many seconds:
// without it the platform's default limit stopped that loading within seconds.
export const maxDuration = 300;

/** GET /api/ready — whether this server shows its whole catalogue yet (for the "still loading" notice). */
export async function GET() {
  await ensureFresh();
  return Response.json({ ready: catalogueComplete(), events: dataSummary().total }, { headers: { "Cache-Control": "no-store" } });
}
