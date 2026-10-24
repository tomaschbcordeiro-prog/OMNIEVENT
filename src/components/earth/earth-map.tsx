"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import maplibregl, { type Map as MLMap, type GeoJSONSource, type MapGeoJSONFeature, type ExpressionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildStyle, layerVisibility, type BaseStyle, type LayerState } from "@/lib/map/style";
import { nightGeoJSON } from "@/lib/map/night";
import { zoomForKind, type CameraState, type ViewState } from "@/lib/map/view";
import { geodesicCircle, circleBounds } from "@/lib/map/circle";
import { GROUP_HEX } from "@/lib/categories";
import type { Cluster } from "@/lib/types";
import { SHARE_BUCKETS, badgeImage, clusterMarker, shareBucket, singleMarker } from "./marker-art";
import { buildPreview } from "./marker-preview";

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
  /** Where the current selection is; after zooming, the marker nearest it keeps the highlight. */
  selectedAt?: { lat: number; lng: number } | null;
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
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

const EVENT_LAYERS = ["event-selected", "event-hover", "event-markers"];

/** Marker size from the number of events it stands for, then a gentle zoom adjustment. */
const sizeByCount: ExpressionSpecification = ["interpolate", ["linear"], ["ln", ["+", ["get", "count"], 1]], 0, 0.82, 2, 0.88, 9, 1.22];
const markerSize = (k: number): ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], 1, ["*", 0.86 * k, sizeByCount], 8, ["*", k, sizeByCount], 14, ["*", 1.08 * k, sizeByCount]];
const countText: ExpressionSpecification = ["case", [">", ["get", "count"], 9999], ["concat", ["to-string", ["round", ["/", ["get", "count"], 1000]]], "k"], [">", ["get", "count"], 1], ["number-format", ["get", "count"], { locale: "en" }], ""];
const countSize: ExpressionSpecification = ["interpolate", ["linear"], ["ln", ["+", ["get", "count"], 1]], 0, 10.5, 9, 13];

const groupColor: ExpressionSpecification = ["match", ["get", "dominant"], ...Object.entries(GROUP_HEX).flat(), GROUP_HEX.other] as unknown as ExpressionSpecification;

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
  const pulseCtl = useRef<{ start(): void; stop(): void } | null>(null);
  const selectedNow = useRef("");
  const popFrame = useRef(0);

  useImperativeHandle(ref, () => ({
    zoomBy(d) {
      const m = mapRef.current;
      if (m) m.easeTo({ zoom: m.getZoom() + d, duration: latest.current.reducedMotion ? 0 : 320, easing: easeOutCubic });
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
        m.fitBounds([[w, s2], [e, n]], { padding: fit, maxZoom: 16, duration: latest.current.reducedMotion ? 0 : 750, easing: easeOutCubic });
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
      for (const g of Object.keys(GROUP_HEX)) {
        if (!map.hasImage(`m1-${g}`)) map.addImage(`m1-${g}`, singleMarker(g), { pixelRatio: 2 });
        for (const b of SHARE_BUCKETS) if (!map.hasImage(`mc-${g}-${b}`)) map.addImage(`mc-${g}-${b}`, clusterMarker(g, b), { pixelRatio: 2 });
      }
      const badge = badgeImage();
      if (!map.hasImage("m-badge")) map.addImage("m-badge", badge.image, badge.options);

      map.addSource("night", { type: "geojson", data: nightGeoJSON() });
      // promoteId lets hover use feature-state without rebuilding the data.
      map.addSource("events", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
      map.addSource("search-area", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("highlight", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      // Night shading sits above imagery and roads, below borders and labels.
      map.addLayer({ id: "night", type: "fill", source: "night", paint: { "fill-color": "#1B2A5C", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.22, 7, 0.12, 10, 0] }, metadata: { omni: { group: "night" } } }, "buildings-3d");
      // Search circle: a light fill that keeps the map readable plus a crisp edge.
      map.addLayer({ id: "search-area-fill", type: "fill", source: "search-area", paint: { "fill-color": "#1463FF", "fill-opacity": 0.08 } });
      map.addLayer({ id: "search-area-line", type: "line", source: "search-area", paint: { "line-color": "#1463FF", "line-width": 2, "line-opacity": 0.9, "line-dasharray": [2, 1.5] } });
      map.addLayer({ id: "event-density", type: "heatmap", source: "events", maxzoom: 12, paint: { "heatmap-weight": ["/", ["ln", ["+", ["get", "count"], 1]], 6], "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 9, 2], "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 14, 6, 30, 11, 50], "heatmap-opacity": 0.75, "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.2, "rgba(123,77,255,0.35)", 0.5, "rgba(240,71,90,0.7)", 0.8, "rgba(255,184,0,0.9)", 1, "#FFF6CC"] }, metadata: { omni: { group: "density" } } });
      // Soft category glow: present under busy clusters, brighter under the hovered marker.
      map.addLayer({
        id: "event-halo",
        type: "circle",
        source: "events",
        paint: {
          "circle-color": groupColor,
          "circle-blur": 0.85,
          "circle-radius": ["interpolate", ["linear"], ["ln", ["+", ["get", "count"], 1]], 0, 18, 9, 40],
          "circle-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.5, ["interpolate", ["linear"], ["ln", ["+", ["get", "count"], 1]], 0, 0, 2, 0.1, 9, 0.28]],
          "circle-pitch-alignment": "viewport",
        },
        metadata: { omni: { group: "events" } },
      });
      // Hover from the results list: a dark ring with a soft glow.
      map.addLayer({ id: "highlight-glow", type: "circle", source: "highlight", paint: { "circle-radius": 30, "circle-color": "#1463FF", "circle-opacity": 0.18, "circle-blur": 0.8, "circle-pitch-alignment": "viewport" } });
      map.addLayer({ id: "highlight-ring", type: "circle", source: "highlight", paint: { "circle-radius": 21, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#0D1B33", "circle-stroke-width": 2.5, "circle-pitch-alignment": "viewport" } });
      const markerLayout = (k: number) =>
        ({
          "icon-image": ["get", "icon"],
          "icon-size": markerSize(k),
          "icon-allow-overlap": true,
          "icon-pitch-alignment": "viewport",
          "text-field": countText,
          "text-font": ["Noto Sans Bold"],
          "text-size": ["*", k, countSize],
          // The cluster disc is drawn 2px below centre to leave room for the badge.
          "text-offset": [0, 0.12],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        }) as maplibregl.SymbolLayerSpecification["layout"];
      map.addLayer({
        id: "event-markers",
        type: "symbol",
        source: "events",
        layout: { ...markerLayout(1), "symbol-sort-key": ["-", 0, ["get", "count"]] },
        paint: { "text-color": "#0D1B33", "icon-opacity": 1, "icon-opacity-transition": { duration: 250 }, "text-opacity": 1, "text-opacity-transition": { duration: 250 } },
        metadata: { omni: { group: "events" } },
      });
      // Names appear once there is room for them.
      map.addLayer({
        id: "event-labels",
        type: "symbol",
        source: "events",
        minzoom: 10,
        layout: {
          "text-field": ["get", "title"],
          "text-font": ["Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10.5, 15, 12.5],
          "text-anchor": "top",
          "text-offset": [0, 1.55],
          "text-max-width": 9,
          "text-optional": true,
          "symbol-sort-key": ["-", 0, ["get", "count"]],
        },
        paint: { "text-color": "#0D1B33", "text-halo-color": "rgba(255,255,255,0.95)", "text-halo-width": 1.6, "text-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0, 10.6, 1] },
        metadata: { omni: { group: "events" } },
      });
      // Selection: a slow pulse, the marker drawn on top, and a name badge above it.
      map.addLayer({ id: "event-pulse", type: "circle", source: "events", filter: ["==", ["get", "id"], ""], paint: { "circle-color": groupColor, "circle-opacity": 0, "circle-radius": 18, "circle-pitch-alignment": "viewport" }, metadata: { omni: { group: "events" } } });
      map.addLayer({ id: "event-hover", type: "symbol", source: "events", filter: ["==", ["get", "id"], ""], layout: markerLayout(1.2), paint: { "text-color": "#0D1B33" }, metadata: { omni: { group: "events" } } });
      map.addLayer({ id: "event-selected", type: "symbol", source: "events", filter: ["==", ["get", "id"], ""], layout: markerLayout(1.25), paint: { "text-color": "#0D1B33" }, metadata: { omni: { group: "events" } } });
      map.addLayer({
        id: "event-badge",
        type: "symbol",
        source: "events",
        filter: ["==", ["get", "id"], ""],
        layout: {
          "icon-image": "m-badge",
          "icon-text-fit": "both",
          "icon-allow-overlap": true,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "text-field": ["case", [">", ["get", "count"], 1], ["format", ["get", "title"], {}, "  ", {}, ["number-format", ["get", "count"], { locale: "en" }], { "text-color": "#FFC94D" }], ["get", "title"]],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
          "text-max-width": 16,
          "text-anchor": "bottom",
          "text-offset": ["case", [">", ["get", "count"], 1], ["literal", [0, -2.75]], ["literal", [0, -2.35]]],
          "icon-anchor": "bottom",
          "icon-offset": [0, 0],
        },
        paint: { "text-color": "#FFFFFF" },
        metadata: { omni: { group: "events" } },
      });

      ready.current = true;
      applyAll();
      setEvents();
      applySelection();
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
    // Instant feedback where you tap, before any data or camera move arrives.
    const ripple = (lngLat: maplibregl.LngLatLike, color: string) => {
      if (latest.current.reducedMotion) return;
      const el = document.createElement("div");
      el.className = "omni-ripple";
      el.style.setProperty("--ripple", color);
      const mk = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
      setTimeout(() => mk.remove(), 720);
    };
    map.on("click", (e) => {
      if (latest.current.pickMode) {
        ripple(e.lngLat, "#1463FF");
        return latest.current.onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.wrap().lng });
      }
      const hit = map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: EVENT_LAYERS.filter((l) => map.getLayer(l)) });
      const dom = hit[0]?.properties?.dominant as string | undefined;
      ripple(hit.length ? (hit[0].geometry as GeoJSON.Point).coordinates as [number, number] : e.lngLat, hit.length ? GROUP_HEX[dom ?? ""] ?? "#1463FF" : "#1463FF");
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

    // ---- hover (desktop): grow the marker, light its glow, show an attached preview card.
    // The card is pointer-events: none, so it never blocks the click on the marker.
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 26, maxWidth: "300px", className: "omni-popup" });
    let hovered: string | number | undefined;
    const setHover = (id: string | number | undefined) => {
      if (hovered === id) return;
      if (hovered !== undefined) map.setFeatureState({ source: "events", id: hovered }, { hover: false });
      hovered = id;
      if (id !== undefined) map.setFeatureState({ source: "events", id }, { hover: true });
      if (map.getLayer("event-hover")) map.setFilter("event-hover", ["==", ["get", "id"], id === undefined || id === selectedNow.current ? "" : String(id)]);
    };
    for (const l of EVENT_LAYERS) {
      map.on("mousemove", l, (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        const id = f?.properties?.id as string | undefined;
        if (!f || !id) return;
        if (id !== hovered) {
          const c = latest.current.clusters.find((x) => x.id === id);
          if (!c) return;
          setHover(id);
          popup.setLngLat([c.lng, c.lat]).setDOMContent(buildPreview(c)).addTo(map);
        }
      });
      map.on("mouseleave", l, () => {
        map.getCanvas().style.cursor = "";
        setHover(undefined);
        popup.remove();
      });
    }
    // Data refreshes replace features, so drop a stale hover when the map moves.
    map.on("movestart", () => {
      setHover(undefined);
      popup.remove();
    });

    // ---- selection pulse: one circle animated in place, paused for reduced motion
    let pulseFrame = 0;
    const pulse = (t: number) => {
      if (!map.getLayer("event-pulse")) return;
      const p = (t % 2200) / 2200;
      const ease = 1 - Math.pow(1 - p, 3);
      map.setPaintProperty("event-pulse", "circle-radius", 18 + ease * 22);
      map.setPaintProperty("event-pulse", "circle-opacity", 0.35 * (1 - ease));
      pulseFrame = requestAnimationFrame(pulse);
    };
    pulseCtl.current = {
      start() {
        cancelAnimationFrame(pulseFrame);
        if (!latest.current.reducedMotion) pulseFrame = requestAnimationFrame(pulse);
        else if (map.getLayer("event-pulse")) map.setPaintProperty("event-pulse", "circle-opacity", 0.2);
      },
      stop() {
        cancelAnimationFrame(pulseFrame);
        if (map.getLayer("event-pulse")) map.setPaintProperty("event-pulse", "circle-opacity", 0);
      },
    };

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
      cancelAnimationFrame(pulseFrame);
      cancelAnimationFrame(popFrame.current);
      popup.remove();
      placeMarker.current?.remove();
      placeMarker.current = null;
      areaMarker.current?.remove();
      areaMarker.current = null;
      ready.current = false;
      map.remove(); // frees GPU resources, workers and tile caches
      mapRef.current = null;
    };
     
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      features: latest.current.clusters.map((c) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [c.lng, c.lat] },
        properties: {
          id: c.id,
          count: c.count,
          dominant: c.dominant,
          label: c.label,
          // A single event is named after itself; a group after its place.
          title: c.count === 1 && c.sample[0] ? c.sample[0].title : c.label,
          icon: c.count > 1 ? `mc-${GROUP_HEX[c.dominant] ? c.dominant : "other"}-${shareBucket(c.count, c.groups[c.dominant] ?? c.count)}` : `m1-${GROUP_HEX[c.dominant] ? c.dominant : "other"}`,
        },
      })),
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

  // Selection: badge + pulse on the chosen marker; the others step back a little.
  function applySelection() {
    const map = mapRef.current;
    if (!map || !ready.current || !map.getLayer("event-selected")) return;
    const { selectedClusterId, selectedAt, clusters } = latest.current;
    let sel = selectedClusterId && clusters.some((c) => c.id === selectedClusterId) ? selectedClusterId : "";
    if (!sel && selectedAt) {
      // Groups re-form at every zoom level: follow the selection to the marker drawn at its place.
      const at = map.project([selectedAt.lng, selectedAt.lat]);
      let best = 40;
      for (const c of clusters) {
        const p = map.project([c.lng, c.lat]);
        const d = Math.hypot(p.x - at.x, p.y - at.y);
        if (d < best) {
          best = d;
          sel = c.id;
        }
      }
    }
    const changed = sel !== selectedNow.current;
    selectedNow.current = sel;
    const present = !!sel;
    if (changed && present) popSelected();
    const f: ExpressionSpecification = ["==", ["get", "id"], present ? sel : ""];
    for (const l of ["event-selected", "event-badge", "event-pulse"]) map.setFilter(l, f);
    map.setPaintProperty("event-markers", "icon-opacity", present ? ["case", ["==", ["get", "id"], sel], 1, 0.5] : 1);
    map.setPaintProperty("event-markers", "text-opacity", present ? ["case", ["==", ["get", "id"], sel], 1, 0.55] : 1);
    if (present) pulseCtl.current?.start();
    else pulseCtl.current?.stop();
  }
  /** A short spring on the newly selected marker: overshoot, then settle at its selected size. */
  function popSelected() {
    const map = mapRef.current;
    if (!map || latest.current.reducedMotion || !map.getLayer("event-selected")) return;
    cancelAnimationFrame(popFrame.current);
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 420);
      // Damped spring from 0.9 to 1.25 with one overshoot.
      const k = 1.25 - 0.35 * Math.exp(-6 * t) * Math.cos(9 * t);
      map.setLayoutProperty("event-selected", "icon-size", markerSize(k));
      map.setLayoutProperty("event-selected", "text-size", ["*", k, countSize]);
      if (t < 1) popFrame.current = requestAnimationFrame(step);
    };
    popFrame.current = requestAnimationFrame(step);
  }
  useEffect(applySelection, [props.selectedClusterId, props.selectedAt?.lat, props.selectedAt?.lng, props.clusters]);  

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
      // A location beacon, deliberately unlike an event marker: a point with a soft pulse.
      const el = document.createElement("div");
      el.className = "omni-beacon";
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", "Selected location");
      el.append(document.createElement("span"));
      placeMarker.current = new maplibregl.Marker({ element: el, anchor: "center" });
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
        map.fitBounds([[f.bbox[0], f.bbox[1]], [f.bbox[2], f.bbox[3]]], { padding: { top: 140, bottom: 80, left: 60, right: window.innerWidth > 1024 ? 440 : 60 }, maxZoom: finite(f.zoom) ? f.zoom : 17, duration: reduced ? 0 : 900, easing: easeOutCubic, ...extra });
        return;
      }
      if (!finite(f.lat) || !finite(f.lng)) return;
      const opts = { center: [f.lng, f.lat] as [number, number], zoom: finite(f.zoom) ? f.zoom : map.getZoom(), ...extra };
      if (reduced) map.jumpTo(opts);
      else {
        // Targets already on screen get a quick glide; far jumps a short, low arc.
        const p = map.project(opts.center);
        const c = map.getCanvas();
        const onScreen = p.x >= 0 && p.y >= 0 && p.x <= c.clientWidth && p.y <= c.clientHeight;
        const dz = Math.abs(opts.zoom - map.getZoom());
        if (onScreen && dz < 6) map.easeTo({ ...opts, duration: Math.min(1100, 520 + dz * 110), easing: easeOutCubic, essential: false });
        else map.flyTo({ ...opts, curve: 1.25, speed: 2.6, maxDuration: 1700, essential: false });
      }
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
