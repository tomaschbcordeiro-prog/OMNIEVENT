"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Globe2, Map as MapIcon, List, SlidersHorizontal, RotateCcw, Plus, Minus, LocateFixed, X, Layers, Pause, Play,
  ChevronDown, ChevronUp, ChevronLeft, MapPin, Clock, Ticket, ExternalLink, Loader2,
} from "lucide-react";
import type { Cluster, EventCard, EventView, ParsedQuery, SearchFilters } from "@/lib/types";
import { GLOBE_MODES, GROUPS } from "@/lib/categories";
import { getDestination } from "@/lib/destinations";
import { cellForAltitude, visibleRadiusKm } from "@/lib/geo";
import { filtersToParams, parseFilterParams, activeFilterCount } from "@/lib/search/params";
import { formatEventDate, formatEventTime, tzAbbrev, relativeTime, formatMoney } from "@/lib/format";
import { useUser, userActions } from "@/lib/user/store";
import { SearchBox } from "../search-box";
import { EventRow } from "../event-card";
import { CategoryIcon, categoryLabel, DemoBadge, EmptyState, ErrorState, Poster, Price, SaveButton, ShapeGlyph, StatusBadge, Notice } from "../ui";
import { FilterForm, ActiveFilters, datePresets } from "./filters";
import { MapView } from "../globe/map-view";
import type { GlobeView, FlyTarget } from "../globe/globe-scene";

const GlobeScene = dynamic(() => import("../globe/globe-scene"), { ssr: false, loading: () => null });

type ViewMode = "globe" | "map" | "list";
type Selection = { kind: "cluster"; cluster: Cluster } | { kind: "event"; card: EventCard; from?: Cluster } | null;

const HOME: GlobeView = { lat: 30, lng: -10, alt: 2.15 };

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

export function DiscoverClient({ dataSummary }: { dataSummary: { demo: number; live: number } }) {
  const user = useUser();
  const reduced = useReducedMotion();
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [mode, setMode] = useState<ViewMode>("globe");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [view, setView] = useState<GlobeView>(HOME);
  const [initialView, setInitialView] = useState<GlobeView | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTarget>();
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [counts, setCounts] = useState<{ total: number; inView: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [density, setDensity] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [globeReady, setGlobeReady] = useState(false);
  const [interp, setInterp] = useState<ParsedQuery | null>(null);
  const [retry, setRetry] = useState(0);
  const [globeNotice, setGlobeNotice] = useState(false);
  const flyKey = useRef(0);

  // ---- boot: read URL state once, detect WebGL ----
  useEffect(() => {
    const ok = hasWebGL();
    setWebgl(ok);
    const sp = new URLSearchParams(window.location.search);
    const p = parseFilterParams(new URLSearchParams([...sp].filter(([k]) => !["v", "view", "sel"].includes(k))));
    if (p.ok) setFilters(p.filters);
    const v = sp.get("v")?.split(",").map(Number);
    const narrow = window.innerWidth < 640;
    const iv = v && v.length === 3 && v.every(Number.isFinite) ? { lat: v[0], lng: v[1], alt: v[2] } : { ...HOME, alt: narrow ? 3.3 : HOME.alt };
    setInitialView(iv);
    setView(iv);
    const m = sp.get("view") as ViewMode | null;
    setMode(m === "map" || m === "list" ? m : ok ? "globe" : "map");
    if (sp.get("v")) setAutoRotate(false);
  }, []);

  // ---- keep URL shareable ----
  // Debounced: trackpad pinches emit hundreds of view changes, and Safari throws a
  // SecurityError after 100 replaceState calls in 10 seconds.
  useEffect(() => {
    if (!initialView) return;
    const t = setTimeout(() => {
      const p = filtersToParams(filters);
      p.set("v", `${view.lat.toFixed(2)},${view.lng.toFixed(2)},${view.alt.toFixed(2)}`);
      if (mode !== "globe") p.set("view", mode);
      const next = `/?${p.toString()}`;
      if (next === `${window.location.pathname}${window.location.search}`) return;
      try {
        window.history.replaceState(window.history.state, "", next);
      } catch {
        // Browser rate limit hit: the URL is a convenience, never worth a crash.
      }
    }, 500);
    return () => clearTimeout(t);
  }, [filters, view, mode, initialView]);

  // ---- viewport-based cluster loading (debounced + cancellable) ----
  const cell = cellForAltitude(view.alt);
  const viewKey = view.alt > 1.4 ? `global:${cell}` : `${view.lat.toFixed(1)},${view.lng.toFixed(1)},${cell},${Math.round(visibleRadiusKm(view.alt))}`;
  const filterKey = filtersToParams({ ...filters, page: undefined, sort: undefined }).toString();
  useEffect(() => {
    if (!initialView || mode === "list") return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams(filterKey);
        p.set("cell", String(cell));
        if (view.alt <= 1.4) {
          p.set("vlat", view.lat.toFixed(3));
          p.set("vlng", view.lng.toFixed(3));
          p.set("vr", String(Math.round(visibleRadiusKm(view.alt) * (mode === "map" ? 1.6 : 1))));
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
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, filterKey, mode, initialView, retry]);

  const fly = useCallback((lat: number, lng: number, alt: number) => {
    flyKey.current++;
    setAutoRotate(false);
    setFlyTo({ lat, lng, alt, key: flyKey.current });
    setView({ lat, lng, alt });
  }, []);

  const onClusterClick = useCallback(
    (c: Cluster) => {
      setAutoRotate(false);
      const small = c.count <= 8 || !!c.venueId || view.alt < 0.3;
      if (small) {
        setSelection(c.count === 1 && c.sample[0] ? { kind: "event", card: c.sample[0] } : { kind: "cluster", cluster: c });
        return;
      }
      setSelection({ kind: "cluster", cluster: c });
      fly(c.lat, c.lng, Math.max(0.12, view.alt / 2.6));
    },
    [view.alt, fly],
  );

  const applyParsed = (p: ParsedQuery) => {
    setInterp(p);
    setFilters({ ...p.filters });
    setSelection(null);
    const place = p.filters.city ?? p.filters.country?.toLowerCase() ?? p.filters.continent;
    const d = place ? getDestination(place) : undefined;
    if (d) fly(d.lat, d.lng, d.kind === "city" ? 0.35 : d.kind === "country" ? 0.9 : 1.5);
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
        setFilters((f) => ({ ...f, near: { lat, lng, radiusKm: 50 }, sort: "distance" }));
        fly(lat, lng, 0.3);
      },
      () => setError("Location permission was not granted. You can still search by city."),
      { maximumAge: 600000, timeout: 10000 },
    );
  };

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-bg">
      {/* ---------- Stage ---------- */}
      <div className="absolute inset-0" aria-hidden={mode === "list"}>
        {mode === "globe" && webgl && initialView && (
          <div className="absolute inset-0" role="region" aria-label="Interactive 3D globe of events. Drag to rotate, scroll or pinch to zoom. Use the map or list view for keyboard access to every event.">
            <GlobeErrorBoundary onError={() => (setMode("map"), setGlobeNotice(true))}>
              <GlobeScene
                clusters={clusters}
                selectedId={selectedId}
                density={density}
                autoRotate={autoRotate && !selection}
                reducedMotion={reduced}
                flyTo={flyTo}
                initialView={initialView}
                onViewChange={setView}
                onClusterClick={onClusterClick}
                onReady={() => setGlobeReady(true)}
                onContextLost={() => (setMode("map"), setGlobeNotice(true))}
              />
            </GlobeErrorBoundary>
            {!globeReady && (
              <div className="absolute inset-0 grid place-items-center pointer-events-none">
                <div className="flex items-center gap-2 text-text-2 t-small">
                  <Loader2 size={16} className="animate-spin" aria-hidden /> Loading Earth
                </div>
              </div>
            )}
          </div>
        )}
        {mode === "map" && initialView && (
          <MapView className="absolute inset-0 pt-[var(--header-h)]" clusters={clusters} initialView={view} flyTo={flyTo} selectedId={selectedId} onViewChange={setView} onClusterClick={onClusterClick} />
        )}
      </div>

      {/* ---------- Top: purpose + search + modes ---------- */}
      <div className="pointer-events-none absolute inset-x-0 top-[var(--header-h)] z-20 px-4 sm:px-6 lg:pr-[380px]">
        <div className="max-w-[1220px]">
          <div className="pointer-events-auto max-w-xl">
            <h1 className="t-h1 text-balance">
              One planet. Every experience.
              <span className="block text-text-2 font-normal text-[0.55em] tracking-normal mt-1.5 leading-snug">
                Spin the Earth or ask for anything, from a match in London to an exhibition in Tokyo.
              </span>
            </h1>
            <SearchBox className="mt-4" size="lg" onQuery={(p) => applyParsed(p)} onPlace={(d) => (setSelection(null), fly(d.lat, d.lng, d.kind === "city" ? 0.35 : d.kind === "country" ? 0.9 : 1.5))} />
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
                      <p key={a} className="text-amber/90 text-[12px] mt-0.5">{a}</p>
                    ))}
                  </div>
                  <button className="text-text-3 hover:text-text" aria-label="Dismiss" onClick={() => setInterp(null)}>
                    <X size={14} aria-hidden />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="pointer-events-auto mt-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1" role="group" aria-label="Globe modes">
            {GLOBE_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className="chip bg-bg/60 backdrop-blur"
                aria-pressed={modeId === m.id}
                onClick={() => setFilters((f) => ({ ...f, categories: m.groups.length ? m.groups : undefined }))}
              >
                {m.groups[0] && <ShapeGlyph group={m.groups[0]} size={9} />}
                {m.label}
              </button>
            ))}
            {modeId === "custom" && (
              <span className="chip bg-bg/60" data-active="true">Custom mix</span>
            )}
            <span className="w-px h-5 bg-line-strong mx-1 shrink-0" aria-hidden />
            {datePresets().slice(0, 2).map((p) => (
              <button key={p.id} type="button" className="chip bg-bg/60 backdrop-blur" aria-pressed={filters.from === p.from && filters.to === p.to} onClick={() => setFilters((f) => (f.from === p.from && f.to === p.to ? { ...f, from: undefined, to: undefined } : { ...f, from: p.from, to: p.to }))}>
                {p.label}
              </button>
            ))}
            <button type="button" className="chip bg-bg/60 backdrop-blur" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)}>
              <SlidersHorizontal size={14} aria-hidden />
              Filters{nFilters ? <span className="tnum text-cyan">{nFilters}</span> : null}
            </button>
          </div>
          {nFilters + (filters.q ? 1 : 0) > 0 && (
            <div className="pointer-events-auto mt-2">
              <ActiveFilters f={filters} onChange={(f) => (setFilters(f), setInterp(null))} />
            </div>
          )}
        </div>
      </div>

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

      {/* ---------- Bottom-left: view switch, controls, legend ---------- */}
      <div className="absolute z-20 left-4 sm:left-6 bottom-4 sm:bottom-6 flex flex-col gap-2 items-start">
        <div className="surface-float rounded-[var(--radius-m)] p-1 flex gap-0.5" role="radiogroup" aria-label="View">
          {([
            ["globe", Globe2, "3D globe"],
            ["map", MapIcon, "2D map"],
            ["list", List, "List"],
          ] as const).map(([m, Icon, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={m === "globe" && webgl === false}
              title={m === "globe" && webgl === false ? "3D isn't supported on this device" : label}
              onClick={() => setMode(m)}
              className={`btn btn-sm ${mode === m ? "bg-white/10 text-text" : "btn-ghost"}`}
            >
              <Icon size={15} aria-hidden />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
        {mode !== "list" && (
          <div className="flex gap-1.5">
            {mode === "globe" && (
              <>
                <button className="btn btn-secondary btn-icon btn-sm" aria-label="Zoom in" onClick={() => fly(view.lat, view.lng, Math.max(0.06, view.alt / 1.8))}>
                  <Plus size={15} aria-hidden />
                </button>
                <button className="btn btn-secondary btn-icon btn-sm" aria-label="Zoom out" onClick={() => fly(view.lat, view.lng, Math.min(3.1, view.alt * 1.8))}>
                  <Minus size={15} aria-hidden />
                </button>
                <button className="btn btn-secondary btn-icon btn-sm" aria-label={autoRotate ? "Stop auto-rotation" : "Start auto-rotation"} aria-pressed={autoRotate} onClick={() => setAutoRotate((a) => !a)} disabled={reduced}>
                  {autoRotate && !reduced ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                </button>
              </>
            )}
            <button className="btn btn-secondary btn-icon btn-sm" aria-label="Reset to whole-planet view" onClick={() => (setSelection(null), fly(HOME.lat, HOME.lng, HOME.alt))}>
              <RotateCcw size={14} aria-hidden />
            </button>
            <button className="btn btn-secondary btn-icon btn-sm" aria-label="Show events near me" title="Use my location (optional, not stored)" onClick={locate}>
              <LocateFixed size={15} aria-hidden />
            </button>
            <button className={`btn btn-secondary btn-sm ${density ? "text-cyan border-cyan/50" : ""}`} aria-pressed={density} onClick={() => setDensity((d) => !d)} disabled={mode !== "globe"}>
              <Layers size={14} aria-hidden /> Density
            </button>
          </div>
        )}
        {mode !== "list" && <Legend />}
      </div>

      {/* ---------- Status line ---------- */}
      <div className="absolute z-10 right-4 sm:right-6 bottom-4 sm:bottom-6 text-right t-micro text-text-3 tnum pointer-events-none hidden md:block" aria-live="polite">
        {loading ? "Loading events" : counts ? `${counts.inView.toLocaleString()} of ${counts.total.toLocaleString()} matching events in view` : ""}
        {dataSummary.live === 0 && <div className="mt-0.5 text-amber/80">Demo mode: all events shown are fictional</div>}
      </div>

      {globeNotice && mode === "map" && (
        <div className="absolute z-30 left-1/2 -translate-x-1/2 bottom-24 w-[min(92vw,460px)] surface-float rounded-[var(--radius-m)] p-3 t-small text-text-2 flex items-start gap-3 panel-in" role="status">
          <span className="flex-1">Your browser ran out of graphics memory for the 3D globe, so we switched to the 2D map. Everything else works the same.</span>
          <button className="btn btn-secondary btn-sm" onClick={() => (setGlobeNotice(false), setGlobeReady(false), setMode("globe"))}>Try 3D again</button>
          <button className="text-text-3 hover:text-text" aria-label="Dismiss" onClick={() => setGlobeNotice(false)}><X size={14} aria-hidden /></button>
        </div>
      )}
      {error && (
        <div className="absolute z-30 left-1/2 -translate-x-1/2 bottom-24 w-[min(92vw,420px)]">
          <ErrorState title="Couldn't load events for this view" body={error} onRetry={() => (setError(null), setRetry((r) => r + 1))} />
        </div>
      )}
      {!loading && !error && counts?.total === 0 && mode !== "list" && (
        <div className="absolute z-20 left-1/2 -translate-x-1/2 top-1/2 w-[min(92vw,420px)] surface-float rounded-[var(--radius-l)] p-5">
          <p className="t-h3">No events match these filters</p>
          <p className="t-small text-text-2 mt-1">Try a wider date range or fewer categories. Missing results don&apos;t mean nothing is happening; our sources don&apos;t cover every event yet.</p>
          <button className="btn btn-secondary btn-sm mt-3" onClick={() => (setFilters({}), setInterp(null))}>Clear filters</button>
        </div>
      )}

      {/* ---------- Right: discovery or selection ---------- */}
      {selection ? (
        <SelectionPanel
          selection={selection}
          filters={filters}
          onClose={() => setSelection(null)}
          onSelectEvent={(c) => {
            setSelection({ kind: "event", card: c, from: selection.kind === "cluster" ? selection.cluster : undefined });
            if (view.alt > 0.5) fly(c.lat, c.lng, 0.25);
          }}
          onBack={selection.kind === "event" && selection.from ? () => setSelection({ kind: "cluster", cluster: selection.from! }) : undefined}
        />
      ) : (
        mode !== "list" && <DiscoveryPanel filters={filters} interests={user.prefs.interests} onPick={(c) => (setSelection({ kind: "event", card: c }), fly(c.lat, c.lng, 0.25))} onCity={(id) => {
          const d = getDestination(id);
          if (d) fly(d.lat, d.lng, 0.35);
          setFilters((f) => ({ ...f, city: id, country: undefined, continent: undefined }));
        }} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ pieces

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
              <ShapeGlyph group={g} size={10} />
              {GROUPS.find((x) => x.slug === g)?.name.split(" &")[0]}
            </li>
          ))}
          <li className="col-span-2 t-micro text-text-3 mt-1 max-w-[240px]">Marker size grows with the number of events. Density mode raises columns by event count.</li>
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
    fetch(`/api/events?${params}`, { signal: ctrl.signal })
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

function MiniList({ title, note, params, onPick, empty }: { title: string; note?: string; params: string; onPick: (c: EventCard) => void; empty: string }) {
  const { items, loading, error } = useEvents(params);
  return (
    <section className="py-3 first:pt-0">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h2 className="t-h3">{title}</h2>
        <Link href={`/events?${params.replace(/&?size=\d+/, "")}`} className="t-micro text-text-3 hover:text-cyan shrink-0">See all</Link>
      </div>
      {note && <p className="t-micro text-text-3 mb-1">{note}</p>}
      {loading ? (
        <div className="grid gap-2 mt-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-11" />)}</div>
      ) : error ? (
        <p className="t-small text-bad">Couldn&apos;t load: {error}</p>
      ) : items.length === 0 ? (
        <p className="t-small text-text-3">{empty}</p>
      ) : (
        <ul>
          {items.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c)} className="w-full flex items-center gap-2.5 py-1.5 text-left group">
                <Poster title={c.title} imageUrl={c.imageUrl} hue={c.posterHue} categorySlug={c.categorySlug} size="sm" className="h-9 w-9 rounded-[5px] shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium group-hover:text-cyan">{c.title}</span>
                  <span className="block truncate t-micro text-text-3 tnum">
                    {c.city}, {c.eventType === "daily_attraction" ? "open daily" : new Date(c.start).getTime() < Date.now() && c.eventType === "multi_day" ? "on now" : formatEventDate(c.start, c.timeZone).replace(/ \d{4}$/, "")}
                  </span>
                </span>
                {c.isDemo && <DemoBadge />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DiscoveryPanel({ filters, interests, onPick, onCity }: { filters: SearchFilters; interests: string[]; onPick: (c: EventCard) => void; onCity: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const base = filtersToParams({ ...filters, from: undefined, to: undefined, page: undefined, sort: undefined });
  const wk = datePresets()[1];
  const weekend = new URLSearchParams(base);
  weekend.set("from", wk.from);
  weekend.set("to", wk.to);
  weekend.set("size", "5");
  const fresh = new URLSearchParams(filtersToParams({ ...filters, sort: "announced", page: undefined }));
  fresh.set("size", "5");
  const forYou = interests.length ? new URLSearchParams({ cat: interests.join(","), size: "5", status: "on_sale" }) : null;
  const [cities, setCities] = useState<{ id: string; name: string; country?: string; stats?: { total: number } }[]>([]);
  useEffect(() => {
    fetch("/api/destinations")
      .then((r) => r.json())
      .then((j) => setCities(j.destinations.filter((d: { kind: string; stats?: { total: number } }) => d.kind === "city" && d.stats).sort((a: { stats: { total: number } }, b: { stats: { total: number } }) => b.stats.total - a.stats.total).slice(0, 6)))
      .catch(() => setCities([]));
  }, []);

  return (
    <aside aria-label="Discover" className="absolute z-20 right-4 sm:right-6 top-[calc(var(--header-h)+0.5rem)] w-[340px] max-h-[calc(100dvh-var(--header-h)-5rem)] hidden lg:flex flex-col surface-float rounded-[var(--radius-l)]">
      <button className="flex items-center justify-between px-4 py-3 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="t-h3">Happening around the world</span>
        {open ? <ChevronUp size={16} aria-hidden className="text-text-3" /> : <ChevronDown size={16} aria-hidden className="text-text-3" />}
      </button>
      {open && (
        <div className="overflow-auto scroll-thin px-4 pb-4 divide-y divide-line">
          {forYou && <MiniList title="For you" note="Based on the interests saved in My World." params={forYou.toString()} onPick={onPick} empty="Nothing on sale matches your interests right now." />}
          <MiniList title="This weekend" params={weekend.toString()} onPick={onPick} empty="Nothing this weekend matches your filters." />
          <MiniList title="Newly announced" params={fresh.toString()} onPick={onPick} empty="No recent announcements match your filters." />
          <section className="pt-3">
            <h2 className="t-h3">Busiest destinations</h2>
            <p className="t-micro text-text-3 mb-1.5">Ranked by number of listed upcoming events, not popularity.</p>
            <ul className="grid grid-cols-2 gap-1.5">
              {cities.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onCity(c.id)} className="w-full text-left rounded-[var(--radius-s)] border border-line px-2.5 py-1.5 hover:border-line-strong">
                    <span className="block text-[13px] font-medium truncate">{c.name}</span>
                    <span className="block t-micro text-text-3 tnum">{c.stats?.total} events</span>
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
      className="absolute z-30 inset-x-0 bottom-0 max-h-[72dvh] lg:inset-auto lg:right-6 lg:top-[calc(var(--header-h)+0.5rem)] lg:bottom-6 lg:w-[400px] lg:max-h-none surface-float rounded-t-[var(--radius-l)] lg:rounded-[var(--radius-l)] flex flex-col panel-in"
    >
      <div className="lg:hidden mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
      {selection.kind === "event" ? (
        <EventPreview card={selection.card} onClose={onClose} onBack={onBack} backLabel={selection.from?.label} />
      ) : (
        <ClusterList cluster={selection.cluster} filters={filters} onClose={onClose} onPick={onSelectEvent} />
      )}
    </aside>
  );
}

function ClusterList({ cluster, filters, onClose, onPick }: { cluster: Cluster; filters: SearchFilters; onClose: () => void; onPick: (c: EventCard) => void }) {
  const city = cluster.cityId ? getDestination(cluster.cityId) : undefined;
  // Fetch the full list for this place: a city filter when the cluster is one city, otherwise a radius.
  const p = filtersToParams({ ...filters, page: undefined, sort: "date" });
  if (city && !cluster.venueId) {
    p.set("city", city.id);
  } else {
    p.set("lat", cluster.lat.toFixed(4));
    p.set("lng", cluster.lng.toFixed(4));
    p.set("radius", cluster.venueId ? "1" : "60");
  }
  p.set("size", "40");
  const { items, total, loading, error } = useEvents(p.toString());
  const groups = Object.entries(cluster.groups).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
        <div className="min-w-0">
          <h2 className="t-h2 truncate">{cluster.label}</h2>
          <p className="t-small text-text-2 tnum">{(total || cluster.count).toLocaleString()} matching events{city ? `, ${city.country}` : ""}</p>
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
          <ul className="divide-y divide-line">
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
        <Poster title={card.title} imageUrl={card.imageUrl} hue={card.posterHue} categorySlug={card.categorySlug} className="h-36 w-full lg:rounded-t-[var(--radius-l)]" />
        <button className="absolute right-2 top-2 btn btn-icon btn-sm bg-bg/70 backdrop-blur text-text" aria-label="Close preview" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
        {onBack && (
          <button className="absolute left-2 top-2 btn btn-sm bg-bg/70 backdrop-blur text-text" onClick={onBack}>
            <ChevronLeft size={15} aria-hidden /> {backLabel ? `Back to ${backLabel}` : "Back"}
          </button>
        )}
        <div className="absolute left-3 bottom-2 flex gap-1.5">
          {card.isDemo && <DemoBadge />}
          <StatusBadge status={card.status} className="bg-bg/80" />
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
                {formatEventDate(card.start, card.timeZone)}, {formatEventTime(card.start, card.timeZone)} <span className="text-text-3">{tzAbbrev(card.start, card.timeZone)} local time</span>
              </>}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="sr-only">Where</dt>
            <MapPin size={15} className="text-text-3 mt-0.5 shrink-0" aria-hidden />
            <dd>
              <Link href={`/venues/${card.venueSlug}`} className="hover:text-cyan">{card.venueName}</Link>
              <span className="text-text-2">, {card.city}, {card.country}</span>
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
          {card.isDemo && <span className="text-amber/90"> This is fictional demo data.</span>}
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

function ListMode({ filters, view, onSelect }: { filters: SearchFilters; view: GlobeView; onSelect: (c: EventCard) => void }) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<EventCard[]>([]);
  const zoomed = view.alt <= 1.4;
  const p = filtersToParams({ ...filters, page, pageSize: 30 });
  if (zoomed && !filters.near && !filters.city && !filters.country) {
    p.set("lat", view.lat.toFixed(3));
    p.set("lng", view.lng.toFixed(3));
    p.set("radius", String(Math.round(visibleRadiusKm(view.alt))));
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

class GlobeErrorBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
