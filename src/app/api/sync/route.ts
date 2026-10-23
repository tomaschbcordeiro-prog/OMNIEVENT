import { NextRequest } from "next/server";
import { forceSync } from "@/lib/store";
import { handler, ok, apiError } from "@/lib/api";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled synchronisation entry point.
 * Called by Vercel Cron (see vercel.json) or any scheduler with
 *   Authorization: Bearer $CRON_SECRET
 * Optional ?provider=ticketmaster to sync one source.
 */
async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return apiError(503, "not_configured", "CRON_SECRET is not set; scheduled sync is disabled.");
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return apiError(401, "unauthorized", "Invalid sync credentials.");
  const provider = req.nextUrl.searchParams.get("provider") ?? undefined;
  const runs = await forceSync(provider);
  log("info", "scheduled sync finished", { runs: runs.map((r) => ({ p: r.provider, ok: r.ok, n: r.imported + r.updated })) });
  return ok({ runs });
}
export const GET = handler(run);
export const POST = handler(run);
