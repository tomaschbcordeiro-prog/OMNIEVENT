import { preconnect } from "react-dom";
import maplibrePkg from "maplibre-gl/package.json";
import { DiscoverClient } from "@/components/discover/discover-client";
import { OpeningScene } from "@/components/opening/opening-scene";
import { MundiviMark } from "@/components/brand";

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
      {/* The opening scene's first frame, drawn by the page itself (shown only when the head's
          script says this is a first visit), so nothing else shows before the scene starts. */}
      <div className="intro-veil" aria-hidden>
        <MundiviMark size={44} ring="#0a1533" />
      </div>
      <OpeningScene />
    </main>
  );
}
