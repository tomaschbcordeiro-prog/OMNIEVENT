"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MLMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildStyle, DEFAULT_LAYERS } from "@/lib/map/style";

export interface RouteStop {
  key: string;
  lat: number;
  lng: number;
  color: string;
  title: string;
  /** A new day starts here (no line from the stop before). */
  newDay?: boolean;
}

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The tape on a map: numbered pins in the order of the tracks, joined by a dashed line within
 * each day. `active` is the track being played or pointed at; the camera follows it while
 * playing.
 */
export function RouteMap({ stops, active, follow, centre, onPick }: { stops: RouteStop[]; active: number | null; follow: boolean; centre: { lat: number; lng: number }; onPick: (i: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const pins = useRef<Marker[]>([]);
  const pick = useRef(onPick);
  pick.current = onPick;
  const activeNow = useRef(active);
  activeNow.current = active;
  /** Shows the whole tape (or the city, when it's empty). */
  const fit = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);

  // The map itself, made once.
  useEffect(() => {
    let gone = false;
    void import("@/lib/map/maplibre").then(({ maplibregl: ml }) => {
      if (gone || !box.current) return;
      const m = new ml.Map({
        container: box.current,
        style: buildStyle({ base: "map", layers: { ...DEFAULT_LAYERS, terrain: false, density: false, events: false, night: false, poi: false } }),
        center: [centre.lng, centre.lat],
        zoom: 11.5,
        attributionControl: { compact: true },
        cooperativeGestures: true,
      });
      m.on("style.load", () => m.setProjection({ type: "mercator" }));
      m.once("load", () => {
        m.addSource("tape", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "tape-glow", type: "line", source: "tape", paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.85 }, layout: { "line-cap": "round", "line-join": "round" } });
        m.addLayer({ id: "tape-line", type: "line", source: "tape", paint: { "line-color": "#0d1b33", "line-width": 3, "line-dasharray": [1.2, 1.6] }, layout: { "line-cap": "round", "line-join": "round" } });
        setReady(true);
      });
      map.current = m;
    });
    return () => {
      gone = true;
      pins.current.forEach((p) => p.remove());
      pins.current = [];
      map.current?.remove();
      map.current = null;
    };
    // The map is made once; the stops move on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pins, the line and the view, whenever the tape changes.
  const sig = stops.map((s) => s.key).join("|");
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    let gone = false;
    void import("@/lib/map/maplibre").then(({ maplibregl: ml }) => {
      if (gone) return;
      pins.current.forEach((p) => p.remove());
      pins.current = stops.map((s, i) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "tape-pin";
        el.style.setProperty("--pin", s.color);
        el.textContent = String(i + 1);
        el.toggleAttribute("data-active", i === activeNow.current);
        el.setAttribute("aria-label", `Track ${i + 1}: ${s.title}`);
        el.addEventListener("click", () => pick.current(i));
        return new ml.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(m);
      });
      // One line per day: the walk or ride between that day's tracks.
      const days: number[][][] = [];
      stops.forEach((s, i) => {
        if (i === 0 || s.newDay) days.push([]);
        days[days.length - 1].push([s.lng, s.lat]);
      });
      (m.getSource("tape") as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: days.filter((d) => d.length > 1).map((coordinates) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } })),
      });
      fit.current = () => {
        if (stops.length) {
          const b = new ml.LngLatBounds();
          stops.forEach((s) => b.extend([s.lng, s.lat]));
          m.fitBounds(b, { padding: 56, maxZoom: 15, duration: reduced() ? 0 : 800 });
        } else m.easeTo({ center: [centre.lng, centre.lat], zoom: 11.5, duration: reduced() ? 0 : 600 });
      };
      fit.current();
    });
    return () => {
      gone = true;
    };
    // `sig` stands for the stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, ready, centre.lat, centre.lng]);

  // The track being played or pointed at.
  useEffect(() => {
    pins.current.forEach((p, i) => p.getElement().toggleAttribute("data-active", i === active));
    const m = map.current;
    const s = active != null ? stops[active] : undefined;
    if (follow && m && s) m.flyTo({ center: [s.lng, s.lat], zoom: Math.max(m.getZoom(), 14.5), duration: reduced() ? 0 : 1400, essential: false });
    // Only when the active track changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, follow, sig]);

  // Back to the whole tape when it stops playing.
  useEffect(() => {
    if (!follow) fit.current();
  }, [follow]);

  return <div ref={box} className="h-full w-full bg-panel-2" />;
}
