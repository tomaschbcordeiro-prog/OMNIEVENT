import type { StyleSpecification, LayerSpecification, ExpressionSpecification } from "maplibre-gl";

/**
 * Map data providers and the single OMNIEVENT map style.
 *
 * One style holds every layer; switching between "Satellite" and "Map" and toggling
 * layers only flips visibility, so the camera, sources and loaded tiles are kept.
 *
 * Providers (all real data, never simulated):
 * - Vector streets/buildings/labels: OpenFreeMap (OpenStreetMap data, OpenMapTiles schema). Free, no key.
 * - Satellite: MapTiler Satellite (up to ~z20, needs NEXT_PUBLIC_MAPTILER_KEY) or, without a key,
 *   EOX Sentinel-2 cloudless 2016 (CC BY 4.0, ~10 m/pixel, sharp to city scale but not street scale).
 * - Terrain: MapTiler Terrain RGB (with key) or AWS Open Data Terrain Tiles (terrarium, no key).
 */

export type BaseStyle = "satellite" | "map";
export type LayerKey = "labels" | "roads" | "borders" | "poi" | "buildings" | "terrain" | "night" | "events" | "density";
export type LayerState = Record<LayerKey, boolean>;

export const DEFAULT_LAYERS: LayerState = {
  labels: true,
  roads: true,
  borders: true,
  poi: true,
  buildings: true,
  terrain: true,
  night: true,
  events: true,
  density: false,
};

export const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || "";

export const PROVIDER_INFO = {
  satellite: MAPTILER_KEY
    ? { name: "MapTiler Satellite", maxzoom: 20, note: "High-resolution aerial and satellite imagery." }
    : { name: "Sentinel-2 cloudless 2016 by EOX", maxzoom: 15, note: "Free 10 m imagery. Add a MapTiler key for street-level detail." },
  terrain: MAPTILER_KEY ? "MapTiler Terrain" : "AWS Open Data Terrain Tiles (Mapzen)",
  vector: "OpenFreeMap (OpenStreetMap)",
};

const FONT = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];

// Every layer we add is tagged so the UI can toggle groups without knowing layer ids.
type Meta = { base?: BaseStyle; group?: LayerKey };
const L = (layer: LayerSpecification, meta: Meta): LayerSpecification => ({ ...layer, metadata: { omni: meta } }) as LayerSpecification;

const name: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];

export function buildStyle(): StyleSpecification {
  const sat = MAPTILER_KEY
    ? {
        type: "raster" as const,
        tiles: [`https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`],
        tileSize: 512,
        maxzoom: 20,
        attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank">© MapTiler</a>',
      }
    : {
        type: "raster" as const,
        tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"],
        tileSize: 256,
        maxzoom: 15,
        attribution:
          '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless by EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2016)',
      };
  const dem = MAPTILER_KEY
    ? {
        type: "raster-dem" as const,
        tiles: [`https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=${MAPTILER_KEY}`],
        tileSize: 512,
        maxzoom: 14,
        encoding: "mapbox" as const,
      }
    : {
        type: "raster-dem" as const,
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 15,
        encoding: "terrarium" as const,
        attribution: '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">Terrain Tiles (Mapzen, AWS Open Data)</a>',
      };

  const layers: LayerSpecification[] = [
    // ------------------------------------------------ base: clean map
    L({ id: "bg", type: "background", paint: { "background-color": "#0B121D" } }, {}),
    L({ id: "landcover", type: "fill", source: "omt", "source-layer": "landcover", paint: { "fill-color": ["match", ["get", "class"], ["wood", "forest"], "#10241C", "grass", "#13261F", ["ice", "glacier"], "#1C2633", "sand", "#231F18", "#0F1C18"], "fill-opacity": 0.75 } }, { base: "map" }),
    L({ id: "landuse", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 9, paint: { "fill-color": ["match", ["get", "class"], ["residential", "suburb", "neighbourhood"], "#111A26", ["commercial", "retail", "industrial"], "#141C29", "#101825"], "fill-opacity": 0.8 } }, { base: "map" }),
    L({ id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": "#11281F", "fill-opacity": 0.8 } }, { base: "map" }),
    L({ id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": "#0A1E33" } }, { base: "map" }),
    L({ id: "waterway", type: "line", source: "omt", "source-layer": "waterway", minzoom: 8, paint: { "line-color": "#0F2A45", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 2.5] } }, { base: "map" }),
    L({ id: "aeroway", type: "fill", source: "omt", "source-layer": "aeroway", minzoom: 11, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#151E2B" } }, { base: "map" }),

    // ------------------------------------------------ base: satellite
    L({ id: "satellite", type: "raster", source: "satellite", paint: { "raster-saturation": -0.08, "raster-contrast": 0.06, "raster-fade-duration": 250, "raster-resampling": "linear" } }, { base: "satellite" }),

    // ------------------------------------------------ terrain shading (both)
    L({ id: "hillshade", type: "hillshade", source: "dem-hs", paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#04070C", "hillshade-highlight-color": "#3A4A60", "hillshade-accent-color": "#0B121D" } }, { group: "terrain" }),

    // ------------------------------------------------ roads (two looks)
    ...(["map", "satellite"] as const).flatMap((b) => {
      const sat = b === "satellite";
      const c = (major: string, minor: string) => (sat ? major : minor);
      return [
        L({ id: `road-minor-${b}`, type: "line", source: "omt", "source-layer": "transportation", minzoom: 12, filter: ["match", ["get", "class"], ["minor", "service", "track", "path"], true, false], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": c("rgba(255,255,255,0.35)", "#1F2B3D"), "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 12, 0.4, 16, 3, 19, 10] } }, { base: b, group: "roads" }),
        L({ id: `road-mid-${b}`, type: "line", source: "omt", "source-layer": "transportation", minzoom: 8, filter: ["match", ["get", "class"], ["secondary", "tertiary"], true, false], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": c("rgba(255,236,190,0.55)", "#2A3A52"), "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 8, 0.4, 14, 2.5, 18, 14] } }, { base: b, group: "roads" }),
        L({ id: `road-major-${b}`, type: "line", source: "omt", "source-layer": "transportation", minzoom: 5, filter: ["match", ["get", "class"], ["motorway", "trunk", "primary"], true, false], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": c("rgba(255,214,140,0.7)", "#3B4F6E"), "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 5, 0.4, 10, 1.6, 14, 4, 18, 20] } }, { base: b, group: "roads" }),
        L({ id: `rail-${b}`, type: "line", source: "omt", "source-layer": "transportation", minzoom: 10, filter: ["match", ["get", "class"], ["rail", "transit"], true, false], paint: { "line-color": c("rgba(200,210,230,0.45)", "#2B3446"), "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 16, 1.5], "line-dasharray": [3, 2] } }, { base: b, group: "roads" }),
      ];
    }),

    // ------------------------------------------------ 3D buildings
    L({
      id: "buildings-3d",
      type: "fill-extrusion",
      source: "omt",
      "source-layer": "building",
      minzoom: 14,
      paint: {
        "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 6], 0, "#2A3548", 60, "#3B4A62", 200, "#55688A"],
        "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, ["coalesce", ["get", "render_height"], 6]],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.88,
      },
    }, { group: "buildings" }),

    // ------------------------------------------------ borders
    L({ id: "border-region", type: "line", source: "omt", "source-layer": "boundary", minzoom: 3, filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]], paint: { "line-color": "rgba(190,205,230,0.35)", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.4, 10, 1.2], "line-dasharray": [3, 2] } }, { group: "borders" }),
    L({ id: "border-country", type: "line", source: "omt", "source-layer": "boundary", filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]], paint: { "line-color": "rgba(230,238,250,0.6)", "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.5, 6, 1.4, 12, 2.5], "line-dasharray": ["case", ["==", ["get", "disputed"], 1], ["literal", [2, 2]], ["literal", [1, 0]]] } }, { group: "borders" }),

    // ------------------------------------------------ labels
    L({ id: "label-water", type: "symbol", source: "omt", "source-layer": "water_name", filter: ["==", ["geometry-type"], "Point"], layout: { "text-field": name, "text-font": ["Noto Sans Italic"], "text-size": ["interpolate", ["linear"], ["zoom"], 1, 10, 8, 14], "text-letter-spacing": 0.1, "text-max-width": 8 }, paint: { "text-color": "#7FA7CF", "text-halo-color": "rgba(5,7,11,0.6)", "text-halo-width": 1 } }, { group: "labels" }),
    L({ id: "label-water-line", type: "symbol", source: "omt", "source-layer": "water_name", filter: ["==", ["geometry-type"], "LineString"], layout: { "text-field": name, "text-font": ["Noto Sans Italic"], "text-size": 12, "symbol-placement": "line", "text-letter-spacing": 0.1 }, paint: { "text-color": "#7FA7CF", "text-halo-color": "rgba(5,7,11,0.6)", "text-halo-width": 1 } }, { group: "labels" }),
    L({ id: "label-waterway", type: "symbol", source: "omt", "source-layer": "waterway", minzoom: 12, layout: { "text-field": name, "text-font": ["Noto Sans Italic"], "text-size": 11, "symbol-placement": "line" }, paint: { "text-color": "#7FA7CF", "text-halo-color": "rgba(5,7,11,0.6)", "text-halo-width": 1 } }, { group: "labels" }),
    L({ id: "label-road", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 13, layout: { "text-field": name, "text-font": FONT, "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 18, 14], "symbol-placement": "line", "text-max-angle": 30 }, paint: { "text-color": "#E8EEF7", "text-halo-color": "rgba(5,7,11,0.85)", "text-halo-width": 1.4 } }, { group: "roads" }),
    L({ id: "label-housenumber", type: "symbol", source: "omt", "source-layer": "housenumber", minzoom: 17, layout: { "text-field": ["get", "housenumber"], "text-font": FONT, "text-size": 10 }, paint: { "text-color": "#9AA8BA", "text-halo-color": "rgba(5,7,11,0.85)", "text-halo-width": 1 } }, { group: "labels" }),
    L({ id: "label-poi", type: "symbol", source: "omt", "source-layer": "poi", minzoom: 14, filter: ["<=", ["coalesce", ["get", "rank"], 99], ["step", ["zoom"], 2, 15, 5, 16, 10, 17, 22, 18, 99]], layout: { "text-field": name, "text-font": FONT, "text-size": 11, "text-anchor": "top", "text-offset": [0, 0.4], "text-max-width": 8, "text-padding": 8, "symbol-sort-key": ["coalesce", ["get", "rank"], 99] }, paint: { "text-color": "#C9D5E6", "text-halo-color": "rgba(5,7,11,0.85)", "text-halo-width": 1.2 } }, { group: "poi" }),
    L({ id: "label-place-minor", type: "symbol", source: "omt", "source-layer": "place", minzoom: 10, filter: ["match", ["get", "class"], ["suburb", "quarter", "neighbourhood", "hamlet", "village", "isolated_dwelling"], true, false], layout: { "text-field": name, "text-font": FONT, "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 15, 13], "text-transform": "none", "text-max-width": 8 }, paint: { "text-color": "#C2CEDF", "text-halo-color": "rgba(5,7,11,0.8)", "text-halo-width": 1.2 } }, { group: "labels" }),
    L({ id: "label-city", type: "symbol", source: "omt", "source-layer": "place", minzoom: 3, filter: ["match", ["get", "class"], ["city", "town"], true, false], layout: { "text-field": name, "text-font": ["step", ["zoom"], ["literal", FONT], 8, ["literal", FONT_BOLD]] as never, "text-size": ["interpolate", ["linear"], ["zoom"], 3, ["case", ["<=", ["coalesce", ["get", "rank"], 10], 3], 12, 10], 8, 14, 13, 18], "text-max-width": 8, "symbol-sort-key": ["coalesce", ["get", "rank"], 99] }, paint: { "text-color": "#F6F8FC", "text-halo-color": "rgba(5,7,11,0.85)", "text-halo-width": 1.4 } }, { group: "labels" }),
    L({ id: "label-state", type: "symbol", source: "omt", "source-layer": "place", minzoom: 4, maxzoom: 8, filter: ["==", ["get", "class"], "state"], layout: { "text-field": name, "text-font": FONT, "text-size": 11, "text-letter-spacing": 0.08, "text-max-width": 7 }, paint: { "text-color": "#A9B7CC", "text-halo-color": "rgba(5,7,11,0.8)", "text-halo-width": 1 } }, { group: "labels" }),
    L({ id: "label-country", type: "symbol", source: "omt", "source-layer": "place", minzoom: 1.5, maxzoom: 9, filter: ["==", ["get", "class"], "country"], layout: { "text-field": name, "text-font": FONT_BOLD, "text-size": ["interpolate", ["linear"], ["zoom"], 2, 11, 6, 16], "text-max-width": 7 }, paint: { "text-color": "#F6F8FC", "text-halo-color": "rgba(5,7,11,0.8)", "text-halo-width": 1.4 } }, { group: "labels" }),
  ];

  return {
    version: 8,
    projection: { type: "globe" },
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sky: {
      "sky-color": "#0A1630",
      "horizon-color": "#2D5A9C",
      "fog-color": "#1B3560",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.5,
      "fog-ground-blend": 0.35,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 8, 0],
    },
    light: { anchor: "map", position: [1.5, 210, 30], intensity: 0.35 },
    sources: {
      omt: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
      satellite: sat,
      dem: dem,
      // Same elevation tiles for hillshading; attribution is already credited once via "dem".
      "dem-hs": Object.fromEntries(Object.entries(dem).filter(([k]) => k !== "attribution")) as typeof dem,
    },
    layers,
  };
}

/** Layer ids grouped for visibility toggling. Derived from metadata so new layers need no extra wiring. */
export function layerVisibility(style: StyleSpecification, base: BaseStyle, layers: LayerState): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const l of style.layers) {
    const meta = (l.metadata as { omni?: Meta } | undefined)?.omni;
    if (!meta) continue;
    out[l.id] = (!meta.base || meta.base === base) && (!meta.group || layers[meta.group]);
  }
  return out;
}
