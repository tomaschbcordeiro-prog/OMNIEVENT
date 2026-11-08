import { catalogueComplete, dataSummary, ensureFresh } from "@/lib/store";

export const dynamic = "force-dynamic";

/** GET /api/ready — whether this server shows its whole catalogue yet (for the "still loading" notice). */
export async function GET() {
  await ensureFresh();
  return Response.json({ ready: catalogueComplete(), events: dataSummary().total }, { headers: { "Cache-Control": "no-store" } });
}
