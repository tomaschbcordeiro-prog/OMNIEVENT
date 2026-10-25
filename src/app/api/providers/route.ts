import { ensureFresh, providerStatuses, dataSummary } from "@/lib/store";
import { FX_SOURCE } from "@/lib/currency";
import { handler, ok } from "@/lib/api";
import { snapshotIndex } from "@/lib/shared-cache";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

export const dynamic = "force-dynamic";

/** GET /api/providers — data sources, configuration state and last sync runs (no secrets). */
export const GET = handler(async () => {
  await ensureFresh();
  // When each source's shared snapshot was saved and how many events it holds.
  const shared = await snapshotIndex().catch(() => ({}));
  return ok({ providers: providerStatuses(), data: dataSummary(), shared, fx: FX_SOURCE, auth: { configured: false, mode: "local-demo" } });
});
