// MapLibre 6 runs its tile work in a module worker that bundlers don't emit: copy it next to the
// site's static files so the map can load it from our own origin (see src/lib/map/maplibre.ts).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require.resolve("maplibre-gl/package.json");
const src = join(dirname(pkg), "dist", "maplibre-gl-worker.mjs");
const out = join(process.cwd(), "public", "maplibre", "maplibre-gl-worker.mjs");
mkdirSync(dirname(out), { recursive: true });
copyFileSync(src, out);
console.log("copied MapLibre worker to public/maplibre/");
