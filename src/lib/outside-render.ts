import { AsyncLocalStorage } from "node:async_hooks";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

/**
 * Runs background work (reading sources, loading shared copies) as if no page were being
 * rendered. Started from a cached page (an event page), Next would otherwise treat every fetch
 * the work makes as part of that page: the page stops being cached and the fetches fail with
 * "couldn't be rendered statically". Other request context (Vercel's, for its shared cache)
 * is kept.
 */
export function outsideRender<T>(fn: () => T): T {
  // Outside Next's server (tests, scripts) its stores are stand-ins and there's no render to leave.
  if (!(workAsyncStorage instanceof AsyncLocalStorage) || !(workUnitAsyncStorage instanceof AsyncLocalStorage)) return fn();
  return workUnitAsyncStorage.exit(() => workAsyncStorage.exit(fn));
}
