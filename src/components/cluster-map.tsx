"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Cluster } from "@/lib/types";
import { cellForAltitude, visibleRadiusKm } from "@/lib/geo";
import { MapView } from "./globe/map-view";
import type { GlobeView } from "./globe/globe-scene";

/**
 * Self-loading 2D map for category / destination / participant pages.
 * `params` are event filter params; clusters reload as the user pans and zooms.
 */
export function ClusterMap({ params, initial, className = "h-80" }: { params: string; initial: GlobeView; className?: string }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [err, setErr] = useState(false);
  const cell = Math.max(0.25, cellForAltitude(view.alt));

  useEffect(() => {
    const ctrl = new AbortController();
    const p = new URLSearchParams(params);
    p.set("cell", String(cell));
    if (view.alt < 1.4) {
      p.set("vlat", view.lat.toFixed(3));
      p.set("vlng", view.lng.toFixed(3));
      p.set("vr", String(Math.round(visibleRadiusKm(view.alt) * 1.8)));
    }
    fetch(`/api/geo?${p}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((j) => (setClusters(j.clusters), setErr(false)))
      .catch((e) => e.name !== "AbortError" && setErr(true));
    return () => ctrl.abort();
  }, [params, cell, view.lat, view.lng, view.alt]);

  return (
    <div className="relative">
      <MapView
        className={`rounded-[var(--radius-l)] border border-line ${className}`}
        clusters={clusters}
        initialView={initial}
        onViewChange={setView}
        onClusterClick={(c) => {
          if (c.cityId) router.push(`/destinations/${c.cityId}`);
          else if (c.sample[0]) router.push(`/events/${c.sample[0].slug}`);
        }}
      />
      {err && <p className="absolute left-3 top-3 t-micro text-bad bg-bg/80 rounded px-2 py-1">Map data unavailable</p>}
    </div>
  );
}
