import { ensureFresh, providerStatuses, dataSummary } from "@/lib/store";
import { FX_SOURCE } from "@/lib/currency";
import { handler, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/providers — data sources, configuration state and last sync runs (no secrets). */
export const GET = handler(async () => {
  await ensureFresh();
  return ok({ providers: providerStatuses(), data: dataSummary(), fx: FX_SOURCE, auth: { configured: false, mode: "local-demo" } });
});
