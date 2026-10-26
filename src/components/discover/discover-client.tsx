"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Globe2, Map as MapIcon, List, SlidersHorizontal, RotateCcw, Plus, Minus, LocateFixed, X, Layers, Pause, Play,
  ChevronDown, ChevronUp, ChevronLeft, MapPin, Clock, Ticket, ExternalLink, Loader2, Maximize, Minimize, Compass, Mountain, Crosshair, Shuffle,
} from "lucide-react";
import type { Cluster, EventCard, EventView, ParsedQuery, SearchFilters } from "@/lib/types";
import type { Summary } from "@/lib/community/types";
import { CommunityPulse } from "../community/pulse";
import { GLOBE_MODES, GROUPS, GROUP_HEX } from "@/lib/categories";
import { getDestination } from "@/lib/destinations";
import { filtersToParams, parseFilterParams, activeFilterCount } from "@/lib/search/params";
import { formatEventDate, formatEventTime, tzAbbrev, relativeTime, formatMoney } from "@/lib/format";
import { useUser, userActions } from "@/lib/user/store";
import { DEFAULT_LAYERS, type BaseStyle, type LayerState } from "@/lib/map/style";
import { HOME, altToZoom, cellForZoom, viewRadiusKm, zoomForKind, type CameraState, type ViewState } from "@/lib/map/view";
import { SearchBox, type GeoPlace } from "../search-box";
import { EventRow } from "../event-card";
import { CategoryIcon, categoryLabel, DemoBadge, EmptyState, ErrorState, Poster, Price, SaveButton, ShapeGlyph, StatusBadge, Notice } from "../ui";
import { FilterForm, ActiveFilters, datePresets } from "./filters";
import type { EarthMapHandle, FlyRequest, MapClick } from "../earth/earth-map";
import { PlacePanel, type SelectedPlace } from "../earth/place-panel";
import { LayersPanel } from "../earth/layers-panel";
import { ExplorePanel } from "../earth/explore-panel";
import { rememberSearch } from "@/lib/search/session";
import { formatKm } from "@/lib/map/circle";
import { sellerSearches } from "@/lib/sellers";

// MapLibre touches `window` on import, so the map only loads in the browser.
const EarthMap = dynamic(() => import("../earth/earth-map").then((m) => m.EarthMap), { ssr: false, loading: () => null });

type ViewMode = "globe" | "map" | "list";
type Selection = { kind: "cluster"; cluster: Cluster } | { kind: "event"; card: EventCard; from?: Cluster } | null;

// v2: the daytime map without night shading became the default.
const PREFS_KEY = "omnievent:map:v2";

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function useReducedMotion(): boolean {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(m.matches);
    const on = () => setR(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return r;
}

const num = (s: string | null) => (s ?? "").split(",").map(Number);

export function DiscoverClient({ dataSummary }: { dataSummary: { demo: number; live: number } }) {
  const user = useUser();
  const reduced = useReducedMotion();
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [mode, setMode] = useState<ViewMode>("globe");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [view, setView] = useState<ViewState>(HOME);
  const [initialView, setInitialView] = useState<CameraState | null>(null);
  const [flyTo, setFlyTo] = useState<FlyRequest>();
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [counts, setCounts] = useState<{ total: number; inView: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [place, setPlace] = useState<SelectedPlace | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [base, setBase] = useState<BaseStyle>("map");
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [autoRotate, setAutoRotate] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailure, setMapFailure] = useState<string | null>(null);
  const [mapKey, setMapKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [interp, setInterp] = useState<ParsedQuery | null>(null);
  const [retry, setRetry] = useState(0);
  const [pickMode, setPickMode] = useState(false);
  const [hovered, setHovered] = useState<{ lat: number; lng: number } | null>(null);
  const [focusedVenue, setFocusedVenue] = useState<string | null>(null);
  const flyKey = useRef(0);
  const history = useRef<CameraState[]>([]);
  const mapApi = useRef<EarthMapHandle>(null);
  const root = useRef<HTMLDivElement>(null);

  // ---- boot: read URL + saved map preferences once, detect WebGL ----
  useEffect(() => {
    const ok = hasWebGL();
    setWebgl(ok);
    const sp = new URLSearchParams(window.location.search);
    const p = parseFilterParams(new URLSearchParams([...sp].filter(([k]) => !["v", "at", "view", "pin", "style"].includes(k))));
    if (p.ok) setFilters(p.filters);
    const narrow = window.innerWidth < 640;
    let iv: CameraState = { ...HOME, zoom: narrow ? 1 : HOME.zoom };
    const at = num(sp.get("at"));
    const v = num(sp.get("v"));
    if (at.length >= 3 && at.slice(0, 3).every(Number.isFinite)) iv = { lat: at[0], lng: at[1], zoom: at[2], bearing: at[3] || 0, pitch: at[4] || 0 };
    else if (v.length === 3 && v.every(Number.isFinite)) iv = { lat: v[0], lng: v[1], zoom: altToZoom(v[2]), pitch: 0, bearing: 0 }; // legacy links
    setInitialView(iv);
    setView(iv);
    const pin = num(sp.get("pin"));
    if (pin.length === 2 && pin.every(Number.isFinite)) setPlace({ lat: pin[0], lng: pin[1] });
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
      if (saved?.base === "map" || saved?.base === "satellite") setBase(saved.base);
      if (saved?.layers) setLayers({ ...DEFAULT_LAYERS, ...saved.layers, ...(narrow ? { terrain: false } : {}) });
      else if (narrow) setLayers({ ...DEFAULT_LAYERS, terrain: false });
    } catch {
      // storage unavailable
    }
    if (sp.get("style") === "map" || sp.get("style") === "satellite") setBase(sp.get("style") as BaseStyle);
    const m = sp.get("view") as ViewMode | null;
    setMode(!ok ? "list" : m === "map" || m === "list" ? m : "globe");
    if (sp.get("at") || sp.get("v") || sp.get("pin")) setAutoRotate(false);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ base, layers }));
    } catch {
      // storage unavailable
    }
  }, [base, layers]);

  // ---- keep URL shareable (debounced: Safari throws after 100 replaceState calls in 10 s) ----
  useEffect(() => {
    if (!initialView) return;
    const t = setTimeout(() => {
      const p = filtersToParams(filters);
      p.set("at", [view.lat.toFixed(4), view.lng.toFixed(4), view.zoom.toFixed(2), Math.round(view.bearing), Math.round(view.pitch)].join(","));
      if (mode !== "globe") p.set("view", mode);
      if (base !== "map") p.set("style", base);
      if (place) p.set("pin", `${place.lat.toFixed(5)},${place.lng.toFixed(5)}`);
      const next = `/?${p.toString()}`;
      if (next === `${window.location.pathname}${window.location.search}`) return;
      try {
        window.history.replaceState(window.history.state, "", next);
      } catch {
        // Rate limited by the browser: the URL is a convenience, never worth a crash.
      }
    }, 500);
    return () => clearTimeout(t);
  }, [filters, view, mode, base, place, initialView]);

  // ---- remember the search for Events / Categories / Destinations ----
  useEffect(() => {
    if (!initialView) return;
    const t = setTimeout(() => rememberSearch(filters), 400);
    return () => clearTimeout(t);
  }, [filters, initialView]);

  // ---- frame the search circle whenever its centre or size changes ----
  const near = filters.near;
  const nearKey = near ? `${near.lat.toFixed(5)},${near.lng.toFixed(5)},${near.radiusKm}` : "";
  useEffect(() => {
    if (!near || !mapReady) return;
    // Fit inside the part of the map that panels don't cover (see framePadding).
    mapApi.current?.frameCircle(near.lat, near.lng, near.radiusKm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearKey, mapReady]);

  /** Start (or move) a radius search, keeping the current radius, dates, times and categories. */
  const explore = useCallback((lat: number, lng: number, label?: string) => {
    setFilters((f) => ({
      ...f,
      near: { lat, lng, radiusKm: f.near?.radiusKm ?? 10 },
      nearLabel: label,
      city: undefined,
      country: undefined,
      continent: undefined,
      page: undefined,
    }));
    setPickMode(false);
    setPlace(null);
    setSelection(null);
    setFocusedVenue(null);
    setAutoRotate(false);
  }, []);

  useEffect(() => {
    if (!pickMode) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPickMode(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickMode]);

  // ---- viewport-based event clusters (debounced + cancellable) ----
  const cell = cellForZoom(view.zoom);
  const radius = viewRadiusKm(view);
  // Zoom in half steps: enough to keep markers apart without refetching on every wheel tick.
  const zKey = Math.round(view.zoom * 2) / 2;
  const viewKey = radius == null ? `global:${cell}:${zKey}` : `${view.lat.toFixed(2)},${view.lng.toFixed(2)},${cell},${Math.round(radius)},${zKey}`;
  const filterKey = filtersToParams({ ...filters, page: undefined, sort: undefined }).toString();
  useEffect(() => {
    if (!initialView || mode === "list") return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams(filterKey);
        p.set("cell", String(cell));
        p.set("z", String(zKey));
        if (radius != null) {
          p.set("vlat", view.lat.toFixed(4));
          p.set("vlng", view.lng.toFixed(4));
          p.set("vr", String(Math.ceil(radius)));
        }
        const res = await fetch(`/api/geo?${p}`, { signal: ctrl.signal });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
        }
        const json = (await res.json()) as { clusters: Cluster[]; total: number; inView: number };
        setClusters(json.clusters);
        setCounts({ total: json.total, inView: json.inView });
        setError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, filterKey, mode, initialView, retry]);

  /** Programmatic camera move. The current view is remembered so "Previous view" can return to it. */
  const fly = useCallback((target: Omit<FlyRequest, "key">) => {
    const cam = mapApi.current?.getCamera();
    if (cam) history.current = [...history.current.slice(-19), cam];
    flyKey.current++;
    setAutoRotate(false);
    setFlyTo({ ...target, key: flyKey.current });
  }, []);

  // Hovering a card in "Happening soon" marks the event on the globe; when the whole planet
  // is in view, the globe also turns to face it after a short pause.
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const peek = useCallback(
    (c: EventCard | null) => {
      clearTimeout(peekTimer.current);
      setHovered(c ? { lat: c.lat, lng: c.lng } : null);
      if (!c || mode !== "globe" || view.zoom > 3.5) return;
      peekTimer.current = setTimeout(() => {
        flyKey.current++;
        setAutoRotate(false);
        setFlyTo({ lat: c.lat, lng: c.lng, zoom: view.zoom, key: flyKey.current });
      }, 350);
    },
    [mode, view.zoom],
  );

  const goBack = () => {
    const prev = history.current.pop();
    if (!prev) return;
    flyKey.current++;
    setFlyTo({ ...prev, key: flyKey.current });
  };

  const onClusterClick = useCallback(
    (c: Cluster) => {
      setAutoRotate(false);
      setPlace(null);
      // In a radius search, picking a venue on the map highlights its events in the results list.
      if (filters.near && (c.venueId || c.count <= 8) && c.count > 1 && c.sample[0]) {
        setSelection(null);
        setFocusedVenue(c.sample[0].venueSlug);
        return;
      }
      const small = c.count <= 8 || !!c.venueId || view.zoom >= 11;
      if (small) {
        setSelection(c.count === 1 && c.sample[0] ? { kind: "event", card: c.sample[0] } : { kind: "cluster", cluster: c });
        return;
      }
      setSelection({ kind: "cluster", cluster: c });
      fly({ lat: c.lat, lng: c.lng, zoom: Math.min(14, Math.max(3.5, view.zoom + 2.5)) });
    },
    [view.zoom, fly, filters.near],
  );

  const onMapClick = useCallback(
    (c: MapClick) => {
      if (pickMode) return explore(c.lat, c.lng);
      setSelection(null);
      setAutoRotate(false);
      if (c.feature) {
        setPlace({ lat: c.lat, lng: c.lng, name: c.feature.name, kind: c.feature.kind, zoom: c.feature.zoom });
        fly({ lat: c.lat, lng: c.lng, zoom: c.feature.zoom });
      } else {
        setPlace({ lat: c.lat, lng: c.lng });
      }
    },
    [fly, pickMode, explore],
  );

  const goToGeoPlace = useCallback(
    (g: GeoPlace) => {
      setSelection(null);
      // During a radius search, a searched place becomes the new centre; radius and times stay.
      if (filters.near || pickMode) return explore(g.lat, g.lng, [g.name, g.context.split(",").slice(-2).join(",").trim()].filter(Boolean).join(", "));
      setPlace({ lat: g.lat, lng: g.lng, name: g.name, kind: g.kind, context: g.context, zoom: zoomForKind(g.kind) });
      fly({ lat: g.lat, lng: g.lng, zoom: zoomForKind(g.kind), bbox: g.bbox });
    },
    [fly, filters.near, pickMode, explore],
  );

  const flyToQuery = async (q: string, kind: string) => {
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}&limit=1`);
      const j = await r.json();
      const g = j.results?.[0];
      if (g) goToGeoPlace({ ...g, kind: g.kind || kind });
    } catch {
      setError("Couldn't find that place right now.");
    }
  };

  const applyParsed = (p: ParsedQuery) => {
    setInterp(p);
    setFilters({ ...p.filters });
    setSelection(null);
    const id = p.filters.city ?? p.filters.country?.toLowerCase() ?? p.filters.continent;
    const d = id ? getDestination(id) : undefined;
    if (d) fly({ lat: d.lat, lng: d.lng, zoom: d.kind === "city" ? 10.5 : d.kind === "country" ? 5 : 2.8 });
  };

  const modeId = useMemo(() => {
    const cats = [...(filters.categories ?? [])].sort().join(",");
    return GLOBE_MODES.find((m) => [...m.groups].sort().join(",") === cats)?.id ?? (cats ? "custom" : "all");
  }, [filters.categories]);

  const selectedId = selection?.kind === "cluster" ? selection.cluster.id : undefined;
  const nFilters = activeFilterCount(filters);

  const locate = () => {
    if (!navigator.geolocation) return setError("Location isn't available in this browser.");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        explore(lat, lng, "Your location");
      },
      () => setError("Location permission was not granted. You can still search by city."),
      { maximumAge: 600000, timeout: 10000 },
    );
  };

  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      // fullscreen not allowed (e.g. iOS Safari on iPhone)
    }
  };

  const projection = mode === "map" ? "mercator" : "globe";
  const showMap = mode !== "list" && webgl && initialView && !mapFailure;
  const tilted = view.pitch > 10;

  return (
    <div ref={root} className="relative h-[100dvh] w-full overflow-hidden sky">
      {loading && mode !== "list" && <div className="map-progress z-50" aria-hidden />}
      {/* ---------- Stage: one map engine, two projections ---------- */}
      <div className="absolute inset-0" aria-hidden={mode === "list"}>
        {showMap && (
          <EarthMap
            key={mapKey}
            ref={mapApi}
            className="absolute inset-0"
            ariaLabel="Interactive map of Earth with events. Drag to move, scroll or pinch to zoom, right-drag or two fingers to tilt and rotate. Arrow keys pan and plus or minus zoom when the map is focused. Use the list view for full keyboard access to every event."
            initial={initialView!}
            projection={projection}
            base={base}
            layers={layers}
            clusters={clusters}
            selectedClusterId={selectedId}
            selectedAt={selection ? (selection.kind === "cluster" ? selection.cluster : selection.card) : null}
            place={place}
            searchArea={filters.near ?? null}
            onSearchAreaMove={(lat, lng) => setFilters((f) => (f.near ? { ...f, near: { ...f.near, lat, lng }, nearLabel: undefined } : f))}
            pickMode={pickMode}
            highlight={hovered}
            framePadding={typeof window !== "undefined" && window.innerWidth >= 1024 ? { top: 200, right: 440, bottom: 110, left: 60 } : { top: 190, right: 30, bottom: Math.round((typeof window !== "undefined" ? window.innerHeight : 800) * 0.5), left: 30 }}
            flyTo={flyTo}
            autoRotate={autoRotate && !selection && !place && !filters.near && !pickMode && mode === "globe"}
            reducedMotion={reduced}
            onView={setView}
            onClusterClick={onClusterClick}
            onMapClick={onMapClick}
            onUserInteract={() => setAutoRotate(false)}
            onReady={() => setMapReady(true)}
            onFatal={(r) => setMapFailure(r)}
          />
        )}
        {showMap && !mapReady && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="flex items-center gap-2 on-sky t-small font-medium">
              <Loader2 size={16} className="animate-spin" aria-hidden /> Loading Earth
            </div>
          </div>
        )}
      </div>

      {/* ---------- Top: purpose + search + modes ---------- */}
      <div className="pointer-events-none absolute inset-x-0 top-[var(--header-h)] z-20 px-4 sm:px-6 lg:pr-[400px]">
        <div className="max-w-[1220px]">
          <div className="pointer-events-auto max-w-xl">
            <h1 className={`text-balance on-sky ${view.zoom > 4 || place || mode === "list" ? "sr-only" : ""}`}>
              <span className="block t-display">One planet.<br />Every experience.</span>
              <span className="block font-medium text-[1.0625rem] leading-snug mt-3 max-w-md text-white/95">
                Spin the Earth, tap a glowing marker, or ask for anything, from a match in London to an exhibition in Tokyo.
              </span>
            </h1>
            <SearchBox
              className="mt-5"
              size="lg"
              mapCenter={{ lat: view.lat, lng: view.lng }}
              onQuery={(p) => applyParsed(p)}
              onPlace={(d) => (setSelection(null), fly({ lat: d.lat, lng: d.lng, zoom: d.kind === "city" ? 10.5 : d.kind === "country" ? 5 : 2.8 }))}
              onGeoPlace={goToGeoPlace}
            />
            {interp && (interp.interpretation.length > 0 || interp.ambiguities.length > 0) && (
              <div className="mt-2 surface-float rounded-[var(--radius-m)] px-3 py-2 t-small text-text-2 panel-in">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    {interp.interpretation.length > 0 && (
                      <p>
                        Showing <span className="text-text">{interp.interpretation.map((i) => i.label).join(", ")}</span>
                        {interp.residual && <> matching <span className="text-text">“{interp.residual}”</span></>}
                      </p>
                    )}
                    {interp.ambiguities.map((a) => (
                      <p key={a} className="text-warn text-[12px] mt-0.5">{a}</p>
                    ))}
                  </div>
                  <button className="text-text-3 hover:text-text" aria-label="Dismiss" onClick={() => setInterp(null)}>
                    <X size={14} aria-hidden />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="pointer-events-auto mt-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1" role="group" aria-label="Event categories">
            {GLOBE_MODES.map((m) => {
              const on = modeId === m.id;
              const hue = m.groups[0] ? GROUP_HEX[m.groups[0]] : undefined;
              return (
                <button
                  key={m.id}
                  type="button"
                  className="chip sky-chip"
                  aria-pressed={on}
                  style={on && hue ? { background: hue, borderColor: hue } : undefined}
                  onClick={() => setFilters((f) => ({ ...f, categories: m.groups.length ? m.groups : undefined }))}
                >
                  {m.groups[0] && !on && <ShapeGlyph group={m.groups[0]} size={16} />}
                  {m.label}
                </button>
              );
            })}
            {modeId === "custom" && (
              <span className="chip sky-chip" data-active="true">Custom mix</span>
            )}
            <span className="w-px h-5 bg-white/60 mx-1 shrink-0" aria-hidden />
            {datePresets().slice(0, 2).map((p) => (
              <button key={p.id} type="button" className="chip sky-chip" aria-pressed={filters.from === p.from && filters.to === p.to} onClick={() => setFilters((f) => (f.from === p.from && f.to === p.to ? { ...f, from: undefined, to: undefined } : { ...f, from: p.from, to: p.to }))}>
                {p.label}
              </button>
            ))}
            <button type="button" className="chip sky-chip" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)}>
              <SlidersHorizontal size={14} aria-hidden />
              Filters{nFilters ? <span className="tnum rounded-full bg-cyan text-white px-1.5 text-[11px] leading-[18px]">{nFilters}</span> : null}
            </button>
          </div>
          {nFilters + (filters.q ? 1 : 0) > 0 && (
            <div className="pointer-events-auto mt-2">
              <ActiveFilters f={filters} onChange={(f) => (setFilters(f), setInterp(null))} />
            </div>
          )}
        </div>
      </div>

      {pickMode && (
        <div role="status" className="absolute z-30 left-1/2 -translate-x-1/2 top-[calc(var(--header-h)+9.5rem)] lg:top-[calc(var(--header-h)+8rem)] surface-float rounded-full pl-4 pr-1.5 py-1.5 flex items-center gap-3 t-small panel-in">
          <Crosshair size={15} className="text-cyan" aria-hidden />
          Click anywhere on the map to explore events nearby
          <button className="btn btn-ghost btn-sm" onClick={() => setPickMode(false)}>Cancel</button>
        </div>
      )}

      {/* ---------- Filters drawer ---------- */}
      {showFilters && (
        <aside className="absolute z-40 inset-x-0 bottom-0 max-h-[80dvh] sm:inset-auto sm:left-6 sm:top-[calc(var(--header-h)+12rem)] sm:bottom-6 sm:w-[380px] sm:max-h-none surface-float rounded-t-[var(--radius-l)] sm:rounded-[var(--radius-l)] flex flex-col panel-in" aria-label="Filters">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <p className="t-h3">Filters</p>
            <button className="btn btn-ghost btn-icon btn-sm" aria-label="Close filters" onClick={() => setShowFilters(false)}>
              <X size={16} aria-hidden />
            </button>
          </div>
          <div className="overflow-auto scroll-thin p-4 flex-1">
            <FilterForm f={filters} onChange={setFilters} />
          </div>
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-line">
            <button className="btn btn-ghost btn-sm" onClick={() => setFilters({})}>Clear all</button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowFilters(false)}>
              Show {counts ? counts.total.toLocaleString() : ""} events
            </button>
          </div>
        </aside>
      )}

      {/* ---------- List mode ---------- */}
      {mode === "list" && (
        <ListMode filters={filters} view={view} onSelect={(c) => setSelection({ kind: "event", card: c })} />
      )}

      {/* ---------- Bottom-left: view switch and map controls ---------- */}
      <div className={`absolute z-20 left-4 sm:left-6 flex flex-col gap-2 items-start ${near && !selection ? "bottom-[13.5rem] lg:bottom-8" : "bottom-8"}`}>
        {showLayers && mode !== "list" && (
          <LayersPanel base={base} layers={layers} onBase={setBase} onLayer={(k, on) => setLayers((l) => ({ ...l, [k]: on }))} onClose={() => setShowLayers(false)} />
        )}
        <div className="surface-float rounded-[var(--radius-m)] p-1 flex gap-0.5" role="radiogroup" aria-label="View">
          {([
            ["globe", Globe2, "3D"],
            ["map", MapIcon, "2D"],
            ["list", List, "List"],
          ] as const).map(([m, Icon, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              aria-label={m === "globe" ? "3D globe" : m === "map" ? "2D map" : "List"}
              disabled={m !== "list" && webgl === false}
              title={m !== "list" && webgl === false ? "Maps need WebGL, which isn't available on this device" : undefined}
              onClick={() => setMode(m)}
              className={`btn btn-sm rounded-[7px] ${mode === m ? "bg-text text-white" : "btn-ghost"}`}
            >
              <Icon size={15} aria-hidden />
              {label}
            </button>
          ))}
        </div>
        {mode !== "list" && (
          <div className="flex flex-wrap gap-1.5 max-w-[calc(100vw-2rem)]">
            <button className="btn btn-secondary btn-icon btn-sm" aria-label="Zoom in" onClick={() => mapApi.current?.zoomBy(1)}>
              <Plus size={15} aria-hidden />
            </button>
            <button className="btn btn-secondary btn-icon btn-sm" aria-label="Zoom out" onClick={() => mapApi.current?.zoomBy(-1)}>
              <Minus size={15} aria-hidden />
            </button>
            <button className={`btn btn-secondary btn-icon btn-sm ${tilted ? "text-cyan" : ""}`} aria-label={tilted ? "Look straight down" : "Tilt for a 3D perspective"} aria-pressed={tilted} onClick={() => mapApi.current?.setPitch(tilted ? 0 : 60)}>
              <Mountain size={15} aria-hidden />
            </button>
            <button className="btn btn-secondary btn-icon btn-sm" aria-label="Point north" title={`Heading ${Math.round(view.bearing)}°`} onClick={() => mapApi.current?.resetNorth()}>
              <Compass size={15} aria-hidden style={{ transform: `rotate(${-view.bearing}deg)` }} />
            </button>
            {mode === "globe" && (
              <button className="btn btn-secondary btn-icon btn-sm" aria-label={autoRotate ? "Stop auto-rotation" : "Start auto-rotation"} aria-pressed={autoRotate} onClick={() => (setAutoRotate((a) => !a), autoRotate ? null : (setPlace(null), setSelection(null)))} disabled={reduced}>
                {autoRotate && !reduced ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
              </button>
            )}
            <button className="btn btn-secondary btn-icon btn-sm" aria-label="Reset to whole-planet view" onClick={() => (setSelection(null), setPlace(null), fly({ ...HOME }))}>
              <RotateCcw size={14} aria-hidden />
            </button>
            <button
              className={`btn btn-sm ${pickMode || near ? "btn-primary" : "btn-secondary"}`}
              aria-pressed={pickMode}
              onClick={() => (near && !pickMode ? setPickMode(true) : setPickMode((p) => !p))}
              title="Pick a point on the map and search a radius around it"
            >
              <Crosshair size={14} aria-hidden /> {near ? `${formatKm(near.radiusKm)} area` : "Explore an area"}
            </button>
            <button className="btn btn-secondary btn-icon btn-sm" aria-label="Show events near me" title="Use my location (optional, not stored)" onClick={locate}>
              <LocateFixed size={15} aria-hidden />
            </button>
            <button className={`btn btn-secondary btn-sm ${showLayers ? "text-cyan border-cyan/50" : ""}`} aria-expanded={showLayers} onClick={() => setShowLayers((s) => !s)}>
              <Layers size={14} aria-hidden /> Layers
            </button>
            <button className="btn btn-secondary btn-icon btn-sm hidden sm:inline-flex" aria-label={fullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>
              {fullscreen ? <Minimize size={14} aria-hidden /> : <Maximize size={14} aria-hidden />}
            </button>
          </div>
        )}
        {mode !== "list" && !showLayers && <Legend />}
      </div>

      {/* ---------- Status line ---------- */}
      <div className="absolute z-10 right-4 sm:right-6 bottom-8 text-right t-micro text-white/85 [text-shadow:0_1px_2px_rgb(10_30_80_/_0.45)] tnum pointer-events-none hidden md:block" aria-live="polite">
        {loading ? "Loading events" : counts ? `${counts.inView.toLocaleString()} of ${counts.total.toLocaleString()} matching events in view` : ""}
        <div className="mt-0.5">Zoom {view.zoom.toFixed(1)}</div>
        {dataSummary.live === 0 && <div className="mt-0.5 text-[#ffd98a]">Demo mode: all events shown are fictional</div>}
      </div>

      {(mapFailure || webgl === false) && (
        <div className="absolute z-30 left-1/2 -translate-x-1/2 bottom-28 w-[min(92vw,460px)] surface-float rounded-[var(--radius-m)] p-3 t-small text-text-2 flex items-start gap-3 panel-in" role="status">
          <span className="flex-1">
            {webgl === false
              ? "This browser can't show the interactive map (WebGL is off or unsupported). Every event is still available in the list."
              : "The map stopped because your browser ran low on graphics memory. Your place and filters are kept."}
          </span>
          {mapFailure && (
            <button className="btn btn-secondary btn-sm" onClick={() => (setMapFailure(null), setMapReady(false), setInitialView(mapApi.current?.getCamera() ?? view), setMapKey((k) => k + 1))}>
              Reload map
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="absolute z-30 left-1/2 -translate-x-1/2 bottom-28 w-[min(92vw,420px)]">
          <ErrorState title="Couldn't load events for this view" body={error} onRetry={() => (setError(null), setRetry((r) => r + 1))} />
        </div>
      )}
      {!loading && !error && counts?.total === 0 && mode !== "list" && !near && (
        <div className="absolute z-20 left-1/2 -translate-x-1/2 top-1/2 w-[min(92vw,420px)] surface-float rounded-[var(--radius-l)] p-5">
          <p className="t-h3">No events match these filters</p>
          <p className="t-small text-text-2 mt-1">Try a wider date range or fewer categories. Missing results don&apos;t mean nothing is happening; our sources don&apos;t cover every event yet.</p>
          <button className="btn btn-secondary btn-sm mt-3" onClick={() => (setFilters({}), setInterp(null))}>Clear filters</button>
        </div>
      )}

      {/* ---------- Right: selection, place, or discovery ---------- */}
      {selection ? (
        <SelectionPanel
          selection={selection}
          filters={filters}
          onClose={() => setSelection(null)}
          onSelectEvent={(c) => {
            setSelection({ kind: "event", card: c, from: selection.kind === "cluster" ? selection.cluster : undefined });
            if (view.zoom < 9 && !filters.near) fly({ lat: c.lat, lng: c.lng, zoom: 13 });
          }}
          onBack={selection.kind === "event" && selection.from ? () => setSelection({ kind: "cluster", cluster: selection.from! }) : undefined}
        />
      ) : place && mode !== "list" ? (
        <PlacePanel
          key={`${place.lat},${place.lng}`}
          place={place}
          canGoBack={history.current.length > 0}
          onClose={() => setPlace(null)}
          onBack={goBack}
          onZoom={() => fly({ lat: place.lat, lng: place.lng, zoom: Math.min(19, Math.max(view.zoom + 2, (place.zoom ?? 0) + 1)) })}
          onExplore={(label) => explore(place.lat, place.lng, label)}
          onLevel={(q, kind) => flyToQuery(q, kind)}
        />
      ) : near && mode !== "list" ? (
        <ExplorePanel
          filters={{ ...filters, near }}
          onChange={setFilters}
          onClose={() => (setFilters((f) => ({ ...f, near: undefined, nearLabel: undefined, sort: f.sort === "distance" ? undefined : f.sort })), setFocusedVenue(null), setHovered(null))}
          onSelect={(c) => (setSelection({ kind: "event", card: c }), setHovered(null))}
          onHover={(c) => setHovered(c ? { lat: c.lat, lng: c.lng } : null)}
          focusedVenue={focusedVenue}
          onClearFocus={() => setFocusedVenue(null)}
        />
      ) : (
        mode !== "list" && <DiscoveryPanel filters={filters} interests={user.prefs.interests} onHover={peek} onPick={(c) => (setHovered(null), clearTimeout(peekTimer.current), setSelection({ kind: "event", card: c }), fly({ lat: c.lat, lng: c.lng, zoom: 13 }))} onCity={(id) => {
          const d = getDestination(id);
          if (d) fly({ lat: d.lat, lng: d.lng, zoom: 10.5 });
          setFilters((f) => ({ ...f, city: id, country: undefined, continent: undefined }));
        }} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ pieces

/** Counts up to a number quickly when it first appears or changes. */
function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setShown(value);
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 650);
      const v = Math.round(start + (value - start) * (1 - Math.pow(1 - t, 3)));
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown.toLocaleString()}</>;
}

function Legend() {
  const [open, setOpen] = useState(false);
  const groups = ["music", "sports", "theatre", "festivals", "conferences", "exhibitions", "attractions", "family"];
  return (
    <div className="surface-float rounded-[var(--radius-m)] px-3 py-2 hidden sm:block">
      <button className="flex items-center gap-1.5 t-micro text-text-2 hover:text-text" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Legend {open ? <ChevronDown size={12} aria-hidden /> : <ChevronUp size={12} aria-hidden />}
      </button>
      {open && (
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
          {groups.map((g) => (
            <li key={g} className="flex items-center gap-2 t-micro text-text-2">
              <ShapeGlyph group={g} size={18} />
              {GROUPS.find((x) => x.slug === g)?.name.split(" &")[0]}
            </li>
          ))}
          <li className="col-span-2 t-micro text-text-3 mt-1 max-w-[260px]">Numbered markers group several events; the coloured ring shows how much of the group is its main category. Zoom in to separate them.</li>
        </ul>
      )}
    </div>
  );
}

function useEvents(params: string | null) {
  const [state, setState] = useState<{ items: EventCard[]; total: number; loading: boolean; error?: string }>({ items: [], total: 0, loading: true });
  useEffect(() => {
    if (params === null) return;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    fetch(params === "buzz" ? "/api/community?view=buzz" : `/api/events?${params}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => setState({ items: j.items, total: j.total, loading: false }))
      .catch((e) => {
        if (e.name !== "AbortError") setState({ items: [], total: 0, loading: false, error: String(e.message) });
      });
    return () => ctrl.abort();
  }, [params]);
  return state;
}

function SpotCard({ c, onPick, onHover }: { c: EventCard & { buzz?: Summary }; onPick: (c: EventCard) => void; onHover: (c: EventCard | null) => void }) {
  const buzz = c.buzz;
  const when = c.eventType === "daily_attraction" ? "Open daily" : new Date(c.start).getTime() < Date.now() && c.eventType === "multi_day" ? "On now" : formatEventDate(c.start, c.timeZone).replace(/ \d{4}$/, "");
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(c)}
        onMouseEnter={() => onHover(c)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(c)}
        onBlur={() => onHover(null)}
        className="group block w-full text-left rounded-[12px] overflow-hidden bg-panel border border-line hover:border-cyan/50 hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-14px_rgb(20_60_130_/_0.55)] transition-[box-shadow,border-color,transform] duration-200 press"
      >
        <span className="relative block">
          <Poster title={c.title} imageUrl={c.imageUrl} hue={c.posterHue} categorySlug={c.categorySlug} size="sm" className="block aspect-[4/3] w-full" />
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-panel/95 px-1.5 py-0.5 text-[11px] font-semibold tnum text-text shadow-sm">
            <ShapeGlyph group={c.groupSlug} size={8} />
            {when}
          </span>
          {c.isDemo && <span className="absolute right-1.5 top-1.5"><DemoBadge /></span>}
          {buzz && (buzz.going > 0 || buzz.posts > 0) && (
            <span className="absolute left-1.5 bottom-1.5 inline-flex items-center gap-1.5 rounded-full bg-text/85 px-1.5 py-0.5 text-[11px] font-semibold tnum text-white backdrop-blur">
              {buzz.going > 0 && <span>🎟️ {buzz.going}</span>}
              {buzz.posts > 0 && <span>💬 {buzz.posts}</span>}
            </span>
          )}
        </span>
        <span className="flex flex-col px-2.5 pt-2 pb-2.5">
          <span className="text-[13px] font-semibold leading-snug line-clamp-2 group-hover:text-cyan">{c.title}</span>
          <span className="flex items-center gap-1 mt-1 t-micro text-text-3 truncate">
            <MapPin size={11} aria-hidden className="shrink-0" />
            <span className="truncate">{c.city}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

function DiscoveryPanel({ filters, interests, onPick, onCity, onHover }: { filters: SearchFilters; interests: string[]; onPick: (c: EventCard) => void; onCity: (id: string) => void; onHover: (c: EventCard | null) => void }) {
  const [open, setOpen] = useState(true);
  const base = filtersToParams({ ...filters, from: undefined, to: undefined, page: undefined, sort: undefined });
  const wk = datePresets()[1];
  const weekend = new URLSearchParams(base);
  weekend.set("from", wk.from);
  weekend.set("to", wk.to);
  weekend.set("size", "8");
  const fresh = new URLSearchParams(filtersToParams({ ...filters, sort: "announced", page: undefined }));
  fresh.set("size", "8");
  const forYou = interests.length ? new URLSearchParams({ cat: interests.join(","), size: "8", status: "on_sale" }) : null;
  const tabs = [
    ...(forYou ? [{ id: "you", label: "For you", params: forYou.toString(), empty: "Nothing on sale matches your interests right now." }] : []),
    { id: "weekend", label: "This weekend", params: weekend.toString(), empty: "Nothing this weekend matches your filters." },
    { id: "new", label: "New", params: fresh.toString(), empty: "No recent announcements match your filters." },
    { id: "buzz", label: "🔥 Buzzing", params: "buzz", empty: "Nothing yet. Say you're going to an event and it shows up here for everyone." },
  ];
  const [tab, setTab] = useState(tabs[0].id);
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];
  const { items, loading, error } = useEvents(active.params);
  const [cities, setCities] = useState<{ id: string; name: string; country?: string; stats?: { total: number } }[]>([]);
  useEffect(() => {
    fetch("/api/destinations")
      .then((r) => r.json())
      .then((j) => setCities(j.destinations.filter((d: { kind: string; stats?: { total: number } }) => d.kind === "city" && d.stats).sort((a: { stats: { total: number } }, b: { stats: { total: number } }) => b.stats.total - a.stats.total)))
      .catch(() => setCities([]));
  }, []);
  // "Surprise me" picks any city with a decent number of listings, not only the biggest ones.
  const surprise = () => {
    const pool = cities.filter((c) => (c.stats?.total ?? 0) >= 10);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) onCity(pick.id);
  };

  return (
    <aside aria-label="Discover" className="absolute z-20 right-4 sm:right-6 top-[calc(var(--header-h)+0.5rem)] w-[360px] max-h-[calc(100dvh-var(--header-h)-5rem)] hidden lg:flex flex-col surface-float rounded-[var(--radius-l)] panel-slide">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        <button className="flex-1 flex items-center gap-1.5 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="t-h3">Happening soon</span>
          {open ? <ChevronUp size={16} aria-hidden className="text-text-3" /> : <ChevronDown size={16} aria-hidden className="text-text-3" />}
        </button>
        <button type="button" className="btn btn-sm rounded-full bg-sun text-text font-semibold hover:brightness-105 shadow-[0_6px_16px_-8px_rgb(200_140_0_/_0.9)]" onClick={surprise} disabled={!cities.length} title="Fly to a random city with events">
          <Shuffle size={14} aria-hidden /> Surprise me
        </button>
      </div>
      {open && (
        <div className="overflow-auto scroll-thin px-4 pb-4">
          <div role="tablist" aria-label="Lists" className="flex gap-1 p-1 rounded-full bg-panel-2 mb-3">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={t.id === active.id} onClick={() => setTab(t.id)} className={`flex-1 rounded-full px-2 py-1.5 text-[12.5px] font-semibold transition-colors ${t.id === active.id ? "bg-panel text-text shadow-sm" : "text-text-2 hover:text-text"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" aria-label={active.label}>
            {loading ? (
              <div className="grid grid-cols-2 gap-2.5">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton aspect-[4/5] rounded-[12px]" />)}</div>
            ) : error ? (
              <p className="t-small text-bad">Couldn&apos;t load: {error}</p>
            ) : items.length === 0 ? (
              <p className="t-small text-text-3">{active.empty}</p>
            ) : (
              <ul key={active.id} className="grid grid-cols-2 gap-2.5 stagger">
                {items.map((c) => <SpotCard key={c.id} c={c} onPick={onPick} onHover={onHover} />)}
              </ul>
            )}
            <Link href={active.id === "buzz" ? "/community" : `/events?${active.params.replace(/&?size=\d+/, "")}`} className="btn btn-secondary btn-sm w-full mt-3">{active.id === "buzz" ? "Open the community" : "See all"}</Link>
          </div>
          <section className="pt-4">
            <h2 className="t-h3">Busiest cities</h2>
            <p className="t-micro text-text-3 mb-2">By number of listed upcoming events.</p>
            <ul className="flex flex-wrap gap-1.5">
              {cities.slice(0, 8).map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onCity(c.id)} className="chip hover:border-cyan/50">
                    <span className="font-semibold text-text">{c.name}</span>
                    <span className="tnum text-text-3">{c.stats?.total.toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </aside>
  );
}

function SelectionPanel({ selection, filters, onClose, onSelectEvent, onBack }: { selection: NonNullable<Selection>; filters: SearchFilters; onClose: () => void; onSelectEvent: (c: EventCard) => void; onBack?: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      aria-label={selection.kind === "event" ? "Event preview" : "Events here"}
      className="absolute z-30 inset-x-0 bottom-0 max-h-[72dvh] lg:inset-auto lg:right-6 lg:top-[calc(var(--header-h)+0.5rem)] lg:bottom-6 lg:w-[400px] lg:max-h-none surface-float rounded-t-[var(--radius-l)] lg:rounded-[var(--radius-l)] flex flex-col panel-slide"
    >
      <div className="lg:hidden mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
      {/* The panel stays put; its content slides in when the selection changes. */}
      <div key={selection.kind === "event" ? selection.card.id : selection.cluster.id} className="content-swap flex flex-col min-h-0 flex-1">
        {selection.kind === "event" ? (
          <EventPreview card={selection.card} onClose={onClose} onBack={onBack} backLabel={selection.from?.label} />
        ) : (
          <ClusterList cluster={selection.cluster} filters={filters} onClose={onClose} onPick={onSelectEvent} />
        )}
      </div>
    </aside>
  );
}

function ClusterList({ cluster, filters, onClose, onPick }: { cluster: Cluster; filters: SearchFilters; onClose: () => void; onPick: (c: EventCard) => void }) {
  const city = cluster.cityId ? getDestination(cluster.cityId) : undefined;
  // Fetch the full list for this place: a city filter when the cluster is one city, otherwise a radius.
  const p = filtersToParams({ ...filters, page: undefined, sort: "date" });
  if (cluster.group?.keys.length) {
    // Exactly the events this marker stands for.
    p.set("gdeg", String(cluster.group.deg));
    p.set("gkeys", cluster.group.keys.join(","));
  } else if (city && !cluster.venueId) {
    p.set("city", city.id);
  } else {
    p.set("lat", cluster.lat.toFixed(4));
    p.set("lng", cluster.lng.toFixed(4));
    // Cover the whole group (it may span several cities), with a little margin.
    p.set("radius", cluster.venueId ? "1" : String(Math.min(2000, Math.max(5, Math.ceil((cluster.radiusKm ?? 55) * 1.05 + 2)))));
  }
  p.set("size", "40");
  const { items, total, loading, error } = useEvents(p.toString());
  const groups = Object.entries(cluster.groups).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
        <div className="min-w-0">
          <h2 className="t-h2 truncate">{cluster.label}</h2>
          <p className="t-small text-text-2 tnum"><CountUp value={total || cluster.count} /> matching events{city ? `, ${city.country}` : ""}</p>
        </div>
        <button className="btn btn-ghost btn-icon btn-sm -mr-1" aria-label="Close" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="px-4 pb-2 flex flex-wrap gap-1.5">
        {groups.slice(0, 6).map(([g, n]) => (
          <span key={g} className="inline-flex items-center gap-1.5 t-micro text-text-2 rounded-full border border-line px-2 py-0.5 tnum">
            <ShapeGlyph group={g} size={8} />
            {categoryLabel(g).split(" &")[0]} {n}
          </span>
        ))}
      </div>
      {city && (
        <div className="px-4 pb-2">
          <Link href={`/destinations/${city.slug}`} className="btn btn-secondary btn-sm w-full">
            <MapPin size={14} aria-hidden /> Open the {city.name} guide
          </Link>
        </div>
      )}
      <div className="overflow-auto scroll-thin px-4 pb-4 flex-1">
        {loading ? (
          <div className="grid gap-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-14" />)}</div>
        ) : error ? (
          <ErrorState title="Couldn't load this place" body={error} />
        ) : items.length === 0 ? (
          <EmptyState title="Nothing here with current filters" />
        ) : (
          <ul className="divide-y divide-line stagger">
            {items.map((c) => (
              <EventRow key={c.id} c={c} onSelect={onPick} compact />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function EventPreview({ card, onClose, onBack, backLabel }: { card: EventCard; onClose: () => void; onBack?: () => void; backLabel?: string }) {
  const user = useUser();
  const [detail, setDetail] = useState<EventView | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    setDetail(null);
    setErr(false);
    userActions.viewed(card.id);
    const ctrl = new AbortController();
    fetch(`/api/events/${encodeURIComponent(card.slug)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setDetail)
      .catch((e) => e.name !== "AbortError" && setErr(true));
    return () => ctrl.abort();
  }, [card.id, card.slug]);

  const people = card.people;
  const offers = detail?.offers ?? [];
  const cheapest = offers.filter((o) => o.basePrice != null && o.availability !== "sold_out").sort((a, b) => a.basePrice! - b.basePrice!)[0];

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="relative shrink-0">
        <div className="overflow-hidden h-36 lg:rounded-t-[var(--radius-l)]">
          <Poster title={card.title} imageUrl={card.imageUrl} hue={card.posterHue} categorySlug={card.categorySlug} className="h-36 w-full media-in" />
        </div>
        <button className="absolute right-2 top-2 btn btn-icon btn-sm bg-panel/85 backdrop-blur text-text" aria-label="Close preview" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
        {onBack && (
          <button className="absolute left-2 top-2 btn btn-sm bg-panel/85 backdrop-blur text-text" onClick={onBack}>
            <ChevronLeft size={15} aria-hidden /> {backLabel ? `Back to ${backLabel}` : "Back"}
          </button>
        )}
        <div className="absolute left-3 bottom-2 flex gap-1.5">
          {card.isDemo && <DemoBadge />}
          <StatusBadge status={card.status} className="bg-panel/90" />
        </div>
      </div>
      <div className="overflow-auto scroll-thin p-4 grid gap-3">
        <div>
          <p className="flex items-center gap-1.5 t-small text-text-2">
            <CategoryIcon slug={card.categorySlug} size={14} />
            {card.sports?.competition ? `${card.sports.competition}${card.sports.stage ? `, ${card.sports.stage}` : ""}` : categoryLabel(card.categorySlug)}
          </p>
          <h2 className="t-h2 mt-1">{card.title}</h2>
          {people.length > 0 && (
            <p className="t-small text-text-2 mt-1">
              {people.slice(0, 4).map((p, i) => (
                <span key={p.slug}>
                  {i > 0 && (card.sports && people.length === 2 ? " vs " : ", ")}
                  <Link href={`/participants/${p.slug}`} className="hover:text-cyan underline-offset-2 hover:underline">{p.name}</Link>
                </span>
              ))}
            </p>
          )}
        </div>
        <dl className="grid gap-1.5 t-small">
          <div className="flex gap-2">
            <dt className="sr-only">When</dt>
            <Clock size={15} className="text-text-3 mt-0.5 shrink-0" aria-hidden />
            <dd className="tnum">
              {card.eventType === "daily_attraction" ? "Open daily, timed entry" : <>
                {formatEventDate(card.start, card.timeZone)}{card.hoursUnknown ? <span className="text-text-3">, times on the official page</span> : <>, {formatEventTime(card.start, card.timeZone)} <span className="text-text-3">{tzAbbrev(card.start, card.timeZone)} local time</span></>}
              </>}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="sr-only">Where</dt>
            <MapPin size={15} className="text-text-3 mt-0.5 shrink-0" aria-hidden />
            <dd>
              <Link href={`/venues/${card.venueSlug}`} className="hover:text-cyan">{card.venueName}</Link>
              <span className="text-text-2">, {card.city}, {card.country}</span>
              {card.distanceKm != null && <span className="block t-micro text-text-3 tnum">{card.distanceKm < 1 ? `${Math.round(card.distanceKm * 1000)} m` : `${card.distanceKm.toFixed(1)} km`} from the search pin</span>}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="sr-only">Price</dt>
            <Ticket size={15} className="text-text-3 mt-0.5 shrink-0" aria-hidden />
            <dd>
              <Price amount={card.fromPrice?.amount} currency={card.fromPrice?.currency} feesIncluded={card.fromPrice?.feesIncluded} isFree={card.isFree} displayCurrency={user.prefs.currency} />
              {card.ticketAccess === "registration" && <span className="text-text-2"> Registration required</span>}
            </dd>
          </div>
        </dl>
        <div className="t-micro text-text-3">
          {card.providers.length > 0 ? <>Ticket info from {card.providers.join(", ")}. </> : null}
          Synced {relativeTime(card.lastSyncedAt)}.
          {card.isDemo && <span className="text-warn"> This is fictional demo data.</span>}
        </div>
        {err && <p className="t-small text-bad">Couldn&apos;t load ticket offers. The full event page may still work.</p>}
        {detail && offers.length > 0 && (
          <div className="rounded-[var(--radius-m)] border border-line p-3">
            <p className="t-small font-medium">{offers.length} ticket {offers.length === 1 ? "option" : "options"} from {new Set(offers.map((o) => o.provider)).size} {new Set(offers.map((o) => o.provider)).size === 1 ? "seller" : "sellers"}</p>
            {cheapest && (
              <p className="t-small text-text-2 mt-0.5 tnum">
                Lowest advertised: {formatMoney(cheapest.basePrice!, cheapest.currency)} at {cheapest.provider}
                {cheapest.feesIncluded === false ? " before fees" : cheapest.feesIncluded ? " incl. fees" : ", fees not stated"}
              </p>
            )}
          </div>
        )}
        {detail && !card.isDemo && card.ticketAccess !== "free" && (() => {
          const sellers = sellerSearches(detail.venue.countryCode, card.title, card.city, offers.map((o) => o.provider));
          return sellers.length ? (
            <div>
              <p className="t-micro text-text-3 mb-1.5">Compare on other ticket sites (opens their search, not checked by us)</p>
              <div className="flex flex-wrap gap-1.5">
                {sellers.map((s) => (
                  <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="chip hover:border-cyan/50">
                    {s.name} <ExternalLink size={12} aria-hidden />
                  </a>
                ))}
              </div>
            </div>
          ) : null;
        })()}
        <CommunityPulse key={card.id} target={`e:${card.id}`} href={`/events/${card.slug}#community`} />
        <div className="grid grid-cols-[1fr_auto] gap-2 pt-1">
          <Link href={`/events/${card.slug}`} className="btn btn-primary">View details</Link>
          <SaveButton id={card.id} title={card.title} />
          {offers.length > 0 && (
            <Link href={`/events/${card.slug}#tickets`} className="btn btn-secondary col-span-2">
              <ExternalLink size={14} aria-hidden /> Compare ticket options
            </Link>
          )}
        </div>
        {card.isDemo && <Notice tone="demo">Demo listings show how OMNIEVENT works. Connect a real provider to see live events and official ticket links.</Notice>}
      </div>
    </div>
  );
}

function ListMode({ filters, view, onSelect }: { filters: SearchFilters; view: ViewState; onSelect: (c: EventCard) => void }) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<EventCard[]>([]);
  const radius = viewRadiusKm(view);
  const zoomed = radius != null;
  const p = filtersToParams({ ...filters, page, pageSize: 30 });
  if (zoomed && !filters.near && !filters.city && !filters.country && !filters.continent) {
    p.set("lat", view.lat.toFixed(3));
    p.set("lng", view.lng.toFixed(3));
    p.set("radius", String(Math.ceil(radius)));
  }
  const key = p.toString();
  const { items: pageItems, total, loading, error } = useEvents(key);
  const baseKey = key.replace(/&?page=\d+/, "");
  useEffect(() => {
    setPage(1);
    setItems([]);
  }, [baseKey]);
  useEffect(() => {
    if (!loading) setItems((prev) => (page === 1 ? pageItems : [...prev, ...pageItems.filter((x) => !prev.some((y) => y.id === x.id))]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageItems, loading]);

  return (
    <div className="absolute inset-0 z-10 overflow-auto scroll-thin bg-bg pt-[calc(var(--header-h)+15rem)] pb-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <p className="t-small text-text-2 mb-2 tnum" aria-live="polite">
          {loading && page === 1 ? "Loading events" : `${total.toLocaleString()} events${zoomed && !filters.city ? " in the area you were viewing" : ""}`}
        </p>
        {error && <ErrorState title="Couldn't load events" body={error} />}
        {!loading && !error && total === 0 && <EmptyState title="No events match these filters" body="Try fewer filters or a wider area." />}
        <ul className="divide-y divide-line">
          {items.map((c) => (
            <EventRow key={c.id} c={c} onSelect={onSelect} />
          ))}
        </ul>
        {items.length < total && (
          <button className="btn btn-secondary w-full mt-4" disabled={loading} onClick={() => setPage((n) => n + 1)}>
            {loading ? "Loading" : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}
