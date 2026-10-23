"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Cluster } from "@/lib/types";
import { DEFAULT_LAYERS } from "@/lib/map/style";
import { cellForZoom, viewRadiusKm, type ViewState } from "@/lib/map/view";

const EarthMap = dynamic(() => import("./earth/earth-map").then((m) => m.EarthMap), {
  ssr: false,
  loading: () => <div className="skeleton absolute inset-0" />,
});

const EMBED_LAYERS = { ...DEFAULT_LAYERS, terrain: false, night: false, poi: false };

/**
 * Embedded street map (Web Mercator) for category, destination, participant and trip pages.
 * Uses the same engine and data as the home globe. `params` are event filter params;
 * clusters reload as the person pans and zooms. Scrolling the page never hijacks the map:
 * zooming needs Ctrl/⌘ + scroll or two fingers (cooperative gestures).
 */
export function ClusterMap({
  params, initial, className = "h-80", clusters: fixed, onClusterClick,
}: {
  params?: string;
  initial: { lat: number; lng: number; zoom: number };
  className?: string;
  /** Show these clusters instead of loading from the API. */
  clusters?: Cluster[];
  onClusterClick?: (c: Cluster) => void;
}) {
  const router = useRouter();
  const [view, setView] = useState<ViewState>({ ...initial, pitch: 0, bearing: 0 });
  const [loaded, setLoaded] = useState<Cluster[]>([]);
  const [err, setErr] = useState(false);
  const cell = Math.max(0.25, cellForZoom(view.zoom));
  const radius = viewRadiusKm(view);
  const cam = useMemo(() => ({ ...initial, pitch: 0, bearing: 0 }), [initial.lat, initial.lng, initial.zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (fixed || params === undefined) return;
    const ctrl = new AbortController();
    const p = new URLSearchParams(params);
    p.set("cell", String(cell));
    if (radius != null) {
      p.set("vlat", view.lat.toFixed(3));
      p.set("vlng", view.lng.toFixed(3));
      p.set("vr", String(Math.ceil(radius)));
    }
    fetch(`/api/geo?${p}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((j) => (setLoaded(j.clusters), setErr(false)))
      .catch((e) => e.name !== "AbortError" && setErr(true));
    return () => ctrl.abort();
  }, [params, cell, fixed, radius == null ? "g" : `${view.lat.toFixed(2)},${view.lng.toFixed(2)},${Math.round(radius)}`]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`relative overflow-hidden rounded-[var(--radius-l)] border border-line ${className}`}>
      <EarthMap
        className="absolute inset-0"
        variant="embed"
        ariaLabel="Map. Use Ctrl or Command with scroll, or two fingers, to zoom."
        initial={cam}
        projection="mercator"
        base="map"
        layers={EMBED_LAYERS}
        clusters={fixed ?? loaded}
        onView={setView}
        onClusterClick={(c) => {
          if (onClusterClick) return onClusterClick(c);
          if (c.cityId && c.count > 1) router.push(`/destinations/${c.cityId}`);
          else if (c.sample[0]) router.push(`/events/${c.sample[0].slug}`);
        }}
      />
      {err && <p className="absolute left-3 top-3 t-micro text-bad bg-bg/80 rounded px-2 py-1">Map data unavailable</p>}
    </div>
  );
}
