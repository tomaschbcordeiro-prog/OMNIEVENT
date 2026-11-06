import { preconnect } from "react-dom";
import maplibrePkg from "maplibre-gl/package.json";
import { DiscoverClient } from "@/components/discover/discover-client";

// The globe's page renders at once; its events load from the API, so a server that is still
// loading data never holds up the first paint.
export default function DiscoverPage() {
  // Open connections to the map tile servers while the page's scripts are still loading.
  preconnect("https://tiles.openfreemap.org", { crossOrigin: "anonymous" });
  preconnect("https://s3.amazonaws.com", { crossOrigin: "anonymous" });
  return (
    <main>
      {/* The map's worker downloads alongside the page's scripts instead of after them. */}
      <link rel="prefetch" href={`/maplibre/maplibre-gl-worker.mjs?v=${maplibrePkg.version}`} />
      <DiscoverClient />
    </main>
  );
}
