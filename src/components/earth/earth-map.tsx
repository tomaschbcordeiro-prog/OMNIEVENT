"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import maplibregl, { type Map as MLMap, type GeoJSONSource, type MapGeoJSONFeature, type ExpressionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildStyle, layerVisibility, type BaseStyle, type LayerState } from "@/lib/map/style";
import { nightGeoJSON } from "@/lib/map/night";
import { zoomForKind, type CameraState, type ViewState } from "@/lib/map/view";
import { geodesicCircle, circleBounds } from "@/lib/map/circle";
import { GROUP_HEX, GROUP_SHAPE } from "@/lib/categories";
import type { Cluster } from "@/lib/types";

export type Projection = "globe" | "mercator";

export interface FlyRequest {
  key: number;
  lat: number;
  lng: number;
  zoom?: number;
  pitch?: number;
  bearing?: number;
  bbox?: [number, number, number, number];
}

export interface MapClick {
  lat: number;
  lng: number;
  /** Present when the click hit a labelled map feature (country, city, street, building…). */
  feature?: { name: string; kind: string; zoom: number };
}

export interface EarthMapHandle {
  zoomBy(delta: number): void;
  resetNorth(): void;
  setPitch(pitch: number): void;
  getCamera(): CameraState | null;
  /** Fit a search circle inside the part of the map not covered by panels. */
  frameCircle(lat: number, lng: number, km: number): void;
}

export interface EarthMapProps {
  initial: CameraState;
  projection: Projection;
  base: BaseStyle;
  layers: LayerState;
  clusters: Cluster[];
  selectedClusterId?: string;
  place?: { lat: number; lng: number } | null;
  /** Radius-search centre and distance; the pin is draggable. */
  searchArea?: { lat: number; lng: number; radiusKm: number } | null;
  onSearchAreaMove?: (lat: number, lng: number) => void;
  /** While true, the cursor is a crosshair: the next click chooses a location. */
  pickMode?: boolean;
  /** Ring drawn around a highlighted event (e.g. hovered in the results list). */
  highlight?: { lat: number; lng: number } | null;
  /** Screen space covered by floating panels, so framing keeps targets visible. */
  framePadding?: { top: number; right: number; bottom: number; left: number };
  flyTo?: FlyRequest;
  autoRotate?: boolean;
  reducedMotion?: boolean;
  /** "embed": small in-page map (cooperative gestures, no globe chrome). */
  variant?: "full" | "embed";
  className?: string;
  ariaLabel?: string;
  onView?: (v: ViewState) => void;
  onClusterClick?: (c: Cluster) => void;
  onMapClick?: (c: MapClick) => void;
  onUserInteract?: () => void;
  onReady?: () => void;
  onFatal?: (reason: string) => void;
}

const PLACE_LAYERS = ["label-country", "label-state", "label-city", "label-place-minor", "label-poi", "label-road", "buildings-3d"];
const EVENT_LAYERS = ["event-markers", "event-halo"];

const groupColor: ExpressionSpecification = ["match", ["get", "dominant"], ...Object.entries(GROUP_HEX).flat(), GROUP_HEX.other] as unknown as ExpressionSpecification;

/** Marker glyphs: the same shapes as the legend, so colour is never the only cue. */
function markerImage(group: string): { width: number; height: number; data: Uint8ClampedArray } {
  const size = 48;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const h = size / 2;
  const r = 15;
  g.beginPath();
  switch (GROUP_SHAPE[group] ?? "circle") {
    case "square": g.rect(h - r * 0.85, h - r * 0.85, r * 1.7, r * 1.7); break;
    case "diamond": g.moveTo(h, h - r); g.lineTo(h + r, h); g.lineTo(h, h + r); g.lineTo(h - r, h); break;
    case "triangle": g.moveTo(h, h - r); g.lineTo(h + r, h + r * 0.8); g.lineTo(h - r, h + r * 0.8); break;
    case "hex":
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        g[i ? "lineTo" : "moveTo"](h + r * Math.cos(a), h + r * Math.sin(a));
      }
      break;
    default: g.arc(h, h, r * 0.9, 0, Math.PI * 2);
  }
  g.closePath();
  g.fillStyle = GROUP_HEX[group] ?? GROUP_HEX.other;
  g.strokeStyle = "rgba(5,7,11,0.9)";
  g.lineWidth = 4;
  g.stroke();
  g.fill();
  return { width: size, height: size, data: g.getImageData(0, 0, size, size).data };
}

function placeKind(f: MapGeoJSONFeature): string {
  if (f.layer.id === "buildings-3d") return "building";
  if (f.layer.id === "label-road") return "street";
  if (f.layer.id === "label-poi") return "poi";
  const cls = String(f.properties?.class ?? "");
  return cls === "neighbourhood" || cls === "quarter" ? "neighbourhood" : cls || "place";
}

export const EarthMap = forwardRef<EarthMapHandle, EarthMapProps>(function EarthMap(props, ref) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const placeMarker = useRef<maplibregl.Marker | null>(null);
  const spinning = useRef(false);

  useImperativeHandle(ref, () => ({
    zoomBy(d) {
      const m = mapRef.current;
      if (m) m.easeTo({ zoom: m.getZoom() + d, duration: latest.current.reducedMotion ? 0 : 400 });
    },
    resetNorth() {
      mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: latest.current.reducedMotion ? 0 : 500 });
    },
    setPitch(p) {
      mapRef.current?.easeTo({ pitch: p, duration: latest.current.reducedMotion ? 0 : 600 });
    },
    frameCircle(lat, lng, km) {
      const m = mapRef.current;
      if (!m) return;
      const [w, s2, e, n] = circleBounds(lat, lng, km);
      const pad = latest.current.framePadding ?? { top: 80, right: 60, bottom: 60, left: 60 };
      // Never ask for more padding than the map has room for.
      const c = m.getCanvas();
      const fit = { top: Math.min(pad.top, c.clientHeight * 0.45), bottom: Math.min(pad.bottom, c.clientHeight * 0.3), left: Math.min(pad.left, c.clientWidth * 0.3), right: Math.min(pad.right, c.clientWidth * 0.45) };
      try {
        m.fitBounds([[w, s2], [e, n]], { padding: fit, maxZoom: 16, duration: latest.current.reducedMotion ? 0 : 900 });
      } catch (err) {
        console.error("frame failed", err);
      }
    },
    getCamera() {
      const m = mapRef.current;
      if (!m) return null;
      const c = m.getCenter();
      return { lat: c.lat, lng: c.lng, zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
    },
  }));

  // ---------------------------------------------------------------- create / destroy
  useEffect(() => {
    if (!box.current) return;
    const p = latest.current;
    const embed = p.variant === "embed";
    const mobile = window.matchMedia("(max-width: 640px)").matches;
    let map: MLMap;
    try {
      map = new maplibregl.Map({
        container: box.current,
        style: buildStyle(),
        center: [p.initial.lng, p.initial.lat],
        zoom: p.initial.zoom,
        pitch: p.initial.pitch,
        bearing: p.initial.bearing,
        maxPitch: 80,
        maxZoom: 19.5,
        attributionControl: { compact: true },
        // Adaptive quality: cap the pixel ratio on phones to save GPU memory.
        pixelRatio: Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2),
        cooperativeGestures: embed,
        fadeDuration: 180,
        maxTileCacheSize: mobile ? 150 : 400,
        canvasContextAttributes: { antialias: !mobile },
      });
    } catch (err) {
      p.onFatal?.(String(err));
      return;
    }
    mapRef.current = map;
    // Exposed for automated browser tests (read-only use).
    (window as unknown as { __omniMaps?: MLMap[] }).__omniMaps = [...((window as unknown as { __omniMaps?: MLMap[] }).__omniMaps ?? []), map];
    map.getCanvas().setAttribute("aria-label", p.ariaLabel ?? "Interactive map");

    map.on("load", () => {
      for (const g of Object.keys(GROUP_HEX)) if (!map.hasImage(`m-${g}`)) map.addImage(`m-${g}`, markerImage(g), { pixelRatio: 2 });

      map.addSource("night", { type: "geojson", data: nightGeoJSON() });
      map.addSource("events", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("search-area", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("highlight", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      // Night shading sits above imagery and roads, below borders and labels.
      map.addLayer({ id: "night", type: "fill", source: "night", paint: { "fill-color": "#020611", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.3, 7, 0.18, 10, 0] }, metadata: { omni: { group: "night" } } }, "buildings-3d");
      // Search circle: a light fill that keeps the map readable plus a crisp edge.
      map.addLayer({ id: "search-area-fill", type: "fill", source: "search-area", paint: { "fill-color": "#42DFFF", "fill-opacity": 0.07 } });
      map.addLayer({ id: "search-area-line", type: "line", source: "search-area", paint: { "line-color": "#42DFFF", "line-width": 1.6, "line-opacity": 0.9 } });
      map.addLayer({ id: "event-density", type: "heatmap", source: "events", maxzoom: 12, paint: { "heatmap-weight": ["/", ["ln", ["+", ["get", "count"], 1]], 6], "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 9, 2], "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 14, 6, 30, 11, 50], "heatmap-opacity": 0.75, "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.2, "rgba(146,117,255,0.35)", 0.5, "rgba(146,117,255,0.75)", 0.8, "rgba(66,223,255,0.9)", 1, "#F6F8FC"] }, metadata: { omni: { group: "density" } } });
      map.addLayer({ id: "event-halo", type: "circle", source: "events", paint: { "circle-color": groupColor, "circle-opacity": 0.2, "circle-radius": ["interpolate", ["linear"], ["ln", ["+", ["get", "count"], 1]], 0, 9, 7, 26], "circle-pitch-alignment": "viewport" }, metadata: { omni: { group: "events" } } });
      map.addLayer({ id: "event-selected", type: "circle", source: "events", filter: ["==", ["get", "id"], ""], paint: { "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#42DFFF", "circle-stroke-width": 2, "circle-radius": ["interpolate", ["linear"], ["ln", ["+", ["get", "count"], 1]], 0, 12, 7, 30] }, metadata: { omni: { group: "events" } } });
      map.addLayer({ id: "highlight-ring", type: "circle", source: "highlight", paint: { "circle-radius": 20, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#F6F8FC", "circle-stroke-width": 2.5, "circle-pitch-alignment": "viewport" } });
      map.addLayer({
        id: "event-markers",
        type: "symbol",
        source: "events",
        layout: {
          "icon-image": ["concat", "m-", ["get", "dominant"]],
          "icon-size": ["interpolate", ["linear"], ["ln", ["+", ["get", "count"], 1]], 0, 0.5, 7, 1.15],
          "icon-allow-overlap": true,
          "icon-pitch-alignment": "viewport",
          "symbol-sort-key": ["-", 0, ["get", "count"]],
          "text-field": ["case", [">", ["get", "count"], 1], ["to-string", ["get", "count"]], ""],
          "text-font": ["Noto Sans Bold"],
          "text-size": 11,
          "text-anchor": "left",
          "text-offset": [1, 0],
          "text-optional": true,
        },
        paint: { "text-color": "#F6F8FC", "text-halo-color": "rgba(5,7,11,0.9)", "text-halo-width": 1.4 },
        metadata: { omni: { group: "events" } },
      });

      ready.current = true;
      applyAll();
      setEvents();
      setArea();
      setHighlight();
      latest.current.onReady?.();
      emitView();
    });

    // ---- view reporting: only on settle, never per frame
    const emitView = () => {
      const c = map.getCenter();
      const b = map.getBounds();
      latest.current.onView?.({ lat: c.lat, lng: c.wrap().lng, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] });
    };
    map.on("moveend", () => {
      if (spinning.current && latest.current.autoRotate) return spin();
      emitView();
    });

    // ---- any direct manipulation stops auto-rotation for good
    const interact = () => {
      spinning.current = false;
      latest.current.onUserInteract?.();
    };
    map.on("mousedown", interact);
    map.on("touchstart", interact);
    map.on("wheel", interact);
    map.on("movestart", (e) => {
      if ((e as { originalEvent?: Event }).originalEvent) interact();
    });

    // ---- clicks: events first, then labelled map features, else a plain point
    map.on("click", (e) => {
      if (latest.current.pickMode) return latest.current.onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.wrap().lng });
      const hit = map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: EVENT_LAYERS.filter((l) => map.getLayer(l)) });
      if (hit.length) {
        const id = hit[0].properties?.id;
        const c = latest.current.clusters.find((x) => x.id === id);
        if (c) return latest.current.onClusterClick?.(c);
      }
      const feats = map.queryRenderedFeatures([[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]], { layers: PLACE_LAYERS.filter((l) => map.getLayer(l) && map.getLayoutProperty(l, "visibility") !== "none") });
      const f = feats.find((x) => x.properties?.name || x.layer.id === "buildings-3d");
      if (f) {
        const kind = placeKind(f);
        const nm = String(f.properties?.["name:en"] ?? f.properties?.name ?? (kind === "building" ? "Building" : "Place"));
        const pt = f.geometry.type === "Point" ? (f.geometry.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
        return latest.current.onMapClick?.({ lat: pt[1], lng: pt[0], feature: { name: nm, kind, zoom: Math.max(map.getZoom(), zoomForKind(kind)) } });
      }
      latest.current.onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    // ---- hover (desktop)
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: "omni-popup" });
    for (const l of EVENT_LAYERS) {
      map.on("mousemove", l, (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f) return;
        const n = Number(f.properties?.count ?? 0);
        const el = document.createElement("div");
        const strong = document.createElement("strong");
        strong.textContent = String(f.properties?.label ?? "");
        el.append(strong, document.createTextNode(`, ${n} ${n === 1 ? "event" : "events"}`));
        popup.setLngLat(e.lngLat).setDOMContent(el).addTo(map);
      });
      map.on("mouseleave", l, () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
    }

    // ---- resilience
    map.on("webglcontextlost", () => latest.current.onFatal?.("webgl-context-lost"));
    map.on("error", (e) => {
      // Tile failures are expected occasionally (offline, provider hiccup); MapLibre retries and shows lower zooms.
      const w = window as unknown as { __omniMapErrors?: string[] };
      (w.__omniMapErrors ??= []).push(String(e.error?.message ?? e.error));
      if (w.__omniMapErrors.length > 50) w.__omniMapErrors.shift();
    });

    // ---- keep the terminator in sync with real time
    const nightTimer = setInterval(() => (map.getSource("night") as GeoJSONSource | undefined)?.setData(nightGeoJSON()), 5 * 60000);

    return () => {
      clearInterval(nightTimer);
      popup.remove();
      placeMarker.current?.remove();
      placeMarker.current = null;
      areaMarker.current?.remove();
      areaMarker.current = null;
      ready.current = false;
      map.remove(); // frees GPU resources, workers and tile caches
      mapRef.current = null;
    };
     
  }, []);

  // ---------------------------------------------------------------- style application
  function applyAll() {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const { base, layers, projection, variant } = latest.current;
    const vis = layerVisibility(map.getStyle(), base, { ...layers, night: layers.night && variant !== "embed" });
    for (const [id, on] of Object.entries(vis)) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    map.setProjection({ type: projection });
    const wantTerrain = layers.terrain && variant !== "embed";
    const hasTerrain = !!map.getTerrain();
    if (wantTerrain && !hasTerrain) map.setTerrain({ source: "dem", exaggeration: 1.25 });
    if (!wantTerrain && hasTerrain) map.setTerrain(null);
  }

  function setEvents() {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const src = map.getSource("events") as GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: latest.current.clusters.map((c) => ({ type: "Feature", geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: { id: c.id, count: c.count, dominant: c.dominant, label: c.label } })),
    });
  }

  function setArea() {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const a = latest.current.searchArea;
    (map.getSource("search-area") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: a ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [geodesicCircle(a.lat, a.lng, a.radiusKm)] } }] : [],
    });
  }

  function setHighlight() {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const h = latest.current.highlight;
    (map.getSource("highlight") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: h ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [h.lng, h.lat] } }] : [] });
  }

  function spin() {
    const map = mapRef.current;
    if (!map || !latest.current.autoRotate || latest.current.reducedMotion || latest.current.projection !== "globe" || map.getZoom() > 4) {
      spinning.current = false;
      return;
    }
    spinning.current = true;
    const c = map.getCenter();
    map.easeTo({ center: [c.lng - 10, c.lat], duration: 5000, easing: (t) => t, essential: true });
  }

  useEffect(applyAll, [props.base, props.layers, props.projection]);  
  useEffect(setEvents, [props.clusters]);  

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current || !map.getLayer("event-selected")) return;
    map.setFilter("event-selected", ["==", ["get", "id"], props.selectedClusterId ?? ""]);
  }, [props.selectedClusterId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (props.autoRotate && !spinning.current) {
      const start = () => spin();
      if (map.loaded()) start();
      else map.once("idle", start);
    } else if (!props.autoRotate && spinning.current) {
      spinning.current = false;
      map.stop();
    }
  }, [props.autoRotate]);  

  useEffect(setArea, [props.searchArea?.lat, props.searchArea?.lng, props.searchArea?.radiusKm]);  
  useEffect(setHighlight, [props.highlight?.lat, props.highlight?.lng]);  

  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = props.pickMode ? "crosshair" : "";
  }, [props.pickMode]);

  // ---- draggable search pin (distinct from the place pin and event markers)
  const areaMarker = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    const a = props.searchArea;
    if (!map) return;
    if (!a) {
      areaMarker.current?.remove();
      areaMarker.current = null;
      return;
    }
    if (!areaMarker.current) {
      const el = document.createElement("div");
      el.className = "omni-search-pin";
      el.title = "Drag to move the search area";
      el.setAttribute("aria-label", "Search area centre. Drag to move.");
      const mk = new maplibregl.Marker({ element: el, anchor: "bottom", draggable: true });
      mk.on("drag", () => {
        const p = mk.getLngLat();
        const cur = latest.current.searchArea;
        if (!cur) return;
        // Live circle while dragging; results update when the pin is dropped.
        (map.getSource("search-area") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [geodesicCircle(p.lat, p.lng, cur.radiusKm)] } }] });
      });
      mk.on("dragend", () => {
        const p = mk.getLngLat().wrap();
        latest.current.onSearchAreaMove?.(p.lat, p.lng);
      });
      areaMarker.current = mk;
    }
    areaMarker.current.setLngLat([a.lng, a.lat]).addTo(map);
  }, [props.searchArea?.lat, props.searchArea?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- selected place pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!props.place) {
      placeMarker.current?.remove();
      placeMarker.current = null;
      return;
    }
    if (!placeMarker.current) {
      const el = document.createElement("div");
      el.className = "omni-pin";
      el.setAttribute("aria-hidden", "true");
      placeMarker.current = new maplibregl.Marker({ element: el, anchor: "bottom" });
    }
    placeMarker.current.setLngLat([props.place.lng, props.place.lat]).addTo(map);
  }, [props.place]);

  // ---- camera requests (search results, cluster clicks, resets). User input interrupts them.
  useEffect(() => {
    const map = mapRef.current;
    const f = props.flyTo;
    if (!map || !f) return;
    spinning.current = false;
    const reduced = latest.current.reducedMotion;
    // Only pass camera fields that are real numbers: MapLibre treats an explicit `undefined`
    // pitch/bearing as NaN, which breaks its camera matrices.
    const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    const extra: { pitch?: number; bearing?: number } = {};
    if (finite(f.pitch)) extra.pitch = f.pitch;
    if (finite(f.bearing)) extra.bearing = f.bearing;
    try {
      if (f.bbox && f.bbox.every(finite) && (f.bbox[2] - f.bbox[0] > 0.002 || f.bbox[3] - f.bbox[1] > 0.002)) {
        map.fitBounds([[f.bbox[0], f.bbox[1]], [f.bbox[2], f.bbox[3]]], { padding: { top: 140, bottom: 80, left: 60, right: window.innerWidth > 1024 ? 440 : 60 }, maxZoom: finite(f.zoom) ? f.zoom : 17, ...(reduced ? { duration: 0 } : {}), ...extra });
        return;
      }
      if (!finite(f.lat) || !finite(f.lng)) return;
      const opts = { center: [f.lng, f.lat] as [number, number], zoom: finite(f.zoom) ? f.zoom : map.getZoom(), ...extra };
      if (reduced) map.jumpTo(opts);
      else map.flyTo({ ...opts, curve: 1.42, speed: 1.3, maxDuration: 4500, essential: false });
    } catch (err) {
      // A bad camera request must never take the page down.
      console.error("camera move failed", err);
    }
  }, [props.flyTo]);

  // MapLibre's stylesheet forces `.maplibregl-map { position: relative }`, which would override
  // layout classes on the container itself, so the map gets its own absolutely-filled box.
  return (
    <div className={props.className}>
      <div ref={box} style={{ position: "absolute", inset: 0 }} />
    </div>
  );
});
