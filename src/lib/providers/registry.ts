import { demoProvider } from "./demo";
import { ticketmasterProvider } from "./ticketmaster";
import type { ProviderAdapter } from "./types";

/**
 * Register new sources here. Each adapter is independent; the store merges and
 * de-duplicates their output. See src/lib/providers/README.md.
 */
export const ALL_PROVIDERS: ProviderAdapter[] = [ticketmasterProvider, demoProvider];

/**
 * Demo data policy:
 *   DEMO_MODE=on    → always include demo data (labelled)
 *   DEMO_MODE=off   → never include demo data
 *   (unset)/auto    → include demo data only when no real provider is configured
 */
export function activeProviders(): ProviderAdapter[] {
  const real = ALL_PROVIDERS.filter((p) => !p.isDemo && p.isConfigured());
  const mode = (process.env.DEMO_MODE ?? "auto").toLowerCase();
  const includeDemo = mode === "on" || (mode !== "off" && real.length === 0);
  return [...real, ...(includeDemo ? ALL_PROVIDERS.filter((p) => p.isDemo) : [])];
}
