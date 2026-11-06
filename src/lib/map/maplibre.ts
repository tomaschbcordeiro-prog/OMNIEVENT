import * as maplibregl from "maplibre-gl";

/**
 * MapLibre, ready to use: its worker is served from our own origin (copied there at build time
 * by scripts/copy-maplibre-worker.mjs), versioned so a library update never meets an old copy.
 */
maplibregl.setWorkerUrl(`/maplibre/maplibre-gl-worker.mjs?v=${maplibregl.getVersion()}`);

export { maplibregl };
