"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, Minus } from "lucide-react";
import type { Cluster } from "@/lib/types";
import { GROUP_HEX } from "@/lib/categories";
import { ShapeGlyph } from "../ui";
import type { GlobeView, FlyTarget } from "./globe-scene";

/**
 * 2D equirectangular map. Lightweight (no tile server, no WebGL) and
 * keyboard-operable — doubles as the fallback when WebGL is unavailable.
 * Markers are real <button>s, so they're reachable by keyboard and screen readers.
 */
export interface MapViewProps {
  clusters: Cluster[];
  initialView: GlobeView;
  flyTo?: FlyTarget;
  selectedId?: string;
  onViewChange: (v: GlobeView) => void;
  onClusterClick: (c: Cluster) => void;
  className?: string;
  /** Hide zoom controls (e.g. small embedded maps). */
  compact?: boolean;
}

const MAX_ZOOM = 64;

/** Map zoom ↔ globe altitude, so switching views preserves the cluster scale. */
export const zoomToAlt = (z: number) => Math.max(0.06, 2.6 / z);
export const altToZoom = (alt: number) => Math.min(MAX_ZOOM, Math.max(1, 2.6 / Math.max(alt, 0.04)));

export function MapView({ clusters, initialView, flyTo, selectedId, onViewChange, onClusterClick, className = "", compact }: MapViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 400 });
  const [view, setView] = useState({ lat: initialView.lat, lng: initialView.lng, zoom: altToZoom(initialView.alt) });
  const drag = useRef<{ x: number; y: number; lat: number; lng: number; moved: boolean } | null>(null);
  const emitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (flyTo) setView({ lat: flyTo.lat, lng: flyTo.lng, zoom: altToZoom(flyTo.alt) });
  }, [flyTo]);

  // World width in px at this zoom: whole world fits the container width at zoom 1.
  const worldW = Math.max(size.w, size.h * 2) * view.zoom;
  const worldH = worldW / 2;
  const toPx = useCallback(
    (lat: number, lng: number) => {
      let dx = ((lng - view.lng) / 360) * worldW;
      // wrap horizontally to the nearest copy
      if (dx > worldW / 2) dx -= worldW;
      if (dx < -worldW / 2) dx += worldW;
      return { x: size.w / 2 + dx, y: size.h / 2 + ((view.lat - lat) / 180) * worldH };
    },
    [view, worldW, worldH, size],
  );

  const clampLat = (lat: number) => {
    const halfSpan = (size.h / worldH) * 90;
    return Math.max(-90 + halfSpan, Math.min(90 - halfSpan, lat));
  };

  const commit = (v: typeof view) => {
    const lat = clampLat(v.lat);
    const lng = ((((v.lng + 180) % 360) + 360) % 360) - 180;
    const next = { lat: Number.isFinite(lat) ? lat : 0, lng, zoom: Math.min(MAX_ZOOM, Math.max(1, v.zoom)) };
    setView(next);
    clearTimeout(emitTimer.current);
    emitTimer.current = setTimeout(() => onViewChange({ lat: next.lat, lng: next.lng, alt: zoomToAlt(next.zoom) }), 200);
  };

  const zoomBy = (f: number) => commit({ ...view, zoom: view.zoom * f });

  // Background image offset: tile the texture horizontally for wrap-around.
  const bgX = size.w / 2 - ((view.lng + 180) / 360) * worldW;
  const bgY = size.h / 2 - ((90 - view.lat) / 180) * worldH;

  return (
    <div
      ref={box}
      role="application"
      aria-label="2D event map. Use arrow keys to pan and plus or minus to zoom."
      tabIndex={0}
      className={`${/\b(absolute|fixed)\b/.test(className) ? "" : "relative"} overflow-hidden bg-bg-2 select-none touch-none cursor-grab active:cursor-grabbing ${className}`}
      onKeyDown={(e) => {
        const step = 40 / view.zoom;
        if (e.key === "ArrowLeft") commit({ ...view, lng: view.lng - step });
        else if (e.key === "ArrowRight") commit({ ...view, lng: view.lng + step });
        else if (e.key === "ArrowUp") commit({ ...view, lat: view.lat + step / 2 });
        else if (e.key === "ArrowDown") commit({ ...view, lat: view.lat - step / 2 });
        else if (e.key === "+" || e.key === "=") zoomBy(1.6);
        else if (e.key === "-") zoomBy(1 / 1.6);
        else return;
        e.preventDefault();
      }}
      onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.25 : 0.8)}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, lat: view.lat, lng: view.lng, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        setView((v) => ({ ...v, lng: d.lng - (dx / worldW) * 360, lat: clampLat(d.lat + (dy / worldH) * 180) }));
      }}
      onPointerUp={() => {
        if (drag.current?.moved) commit(view);
        drag.current = null;
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: "url(/textures/earth-night.jpg), url(/textures/earth-blue-marble.jpg)",
          backgroundBlendMode: "screen",
          backgroundSize: `${worldW}px ${worldH}px`,
          backgroundPosition: `${bgX}px ${bgY}px`,
          backgroundRepeat: "repeat-x",
          filter: "saturate(0.7) brightness(0.55)",
        }}
      />
      {clusters.slice(0, 500).map((c) => {
        const p = toPx(c.lat, c.lng);
        if (p.x < -20 || p.y < -20 || p.x > size.w + 20 || p.y > size.h + 20) return null;
        const s = 10 + Math.min(18, Math.log2(c.count + 1) * 3);
        const sel = c.id === selectedId;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onClusterClick(c)}
            aria-label={`${c.label}: ${c.count} ${c.count === 1 ? "event" : "events"}`}
            title={`${c.label}, ${c.count}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 grid place-items-center rounded-full focus-visible:outline-2"
            style={{ left: p.x, top: p.y, width: s + 8, height: s + 8, background: `${GROUP_HEX[c.dominant]}26`, boxShadow: sel ? `0 0 0 2px ${GROUP_HEX[c.dominant]}` : undefined }}
          >
            <ShapeGlyph group={c.dominant} size={Math.round(s * 0.6)} />
            {c.count > 1 && view.zoom > 1.5 && (
              <span aria-hidden className="absolute left-full top-1/2 -translate-y-1/2 ml-0.5 whitespace-nowrap rounded bg-bg/75 px-1 text-[11px] font-semibold leading-4 tnum text-text">{c.count}</span>
            )}
          </button>
        );
      })}
      {!compact && (
        <div className="absolute right-3 bottom-3 flex flex-col gap-1">
          <button type="button" className="btn btn-secondary btn-icon btn-sm" aria-label="Zoom in" onClick={() => zoomBy(1.6)}>
            <Plus size={15} aria-hidden />
          </button>
          <button type="button" className="btn btn-secondary btn-icon btn-sm" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.6)}>
            <Minus size={15} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
