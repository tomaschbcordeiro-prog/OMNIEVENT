"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe2, Map as MapIcon, List, SlidersHorizontal, RotateCcw, Plus, Minus, LocateFixed, X, Layers, Pause, Play, ChevronDown, ChevronUp, ChevronLeft, MapPin, Clock, Ticket, ExternalLink, Loader2, Maximize, Minimize, Compass, Mountain, Crosshair, Dices, Plane, Ellipsis } from "lucide-react";
import type { Cluster, EventCard, EventView, ParsedQuery, SearchFilters } from "@/lib/types";
import type { Summary } from "@/lib/community/types";
import { CommunityPulse } from "../community/pulse";
import { GLOBE_MODES, GROUPS, GROUP_HEX } from "@/lib/categories";
import { getDestination } from "@/lib/destinations";
import { filtersToParams, parseFilterParams, activeFilterCount } from "@/lib/search/params";
import { cardWhen, formatEventDate, formatEventTime, tzAbbrev, relativeTime, formatMoney } from "@/lib/format";
import { useUser, userActions } from "@/lib/user/store";
import { DEFAULT_LAYERS, isBaseStyle, type BaseStyle, type LayerState } from "@/lib/map/style";
import { HOME, altToZoom, cellForZoom, fitGlobeZoom, globeRadiusPx, viewRadiusKm, zoomForKind, type CameraState, type ViewState } from "@/lib/map/view";
import { SearchBox, type GeoPlace } from "../search-box";
import { EventRow } from "../event-card";
import { CategoryIcon, categoryLabel, DemoBadge, EmptyState, ErrorState, Poster, Price, SaveButton, ShapeGlyph, StatusBadge, Notice } from "../ui";
import { TripButton } from "../trips/trip-add";
import { snapOf } from "@/lib/after-event";
import { FilterForm, ActiveFilters, datePresets } from "./filters";
import { TapLabel } from "../tap-label";
import { TimeBar } from "../earth/time-bar";
import type { EarthMapHandle, FlyRequest, MapClick } from "../earth/earth-map";
import { PlacePanel, type SelectedPlace } from "../earth/place-panel";
import { LayersPanel } from "../earth/layers-panel";
import { ExplorePanel } from "../earth/explore-panel";
import { GlobeSpin } from "../earth/globe-spin";
import { NightFlight, flightPadBottom } from "../earth/night-flight";
import { rememberSearch } from "@/lib/search/session";
import { formatKm } from "@/lib/map/circle";
import { sellerSearches } from "@/lib/sellers";
import { isDarkNow, useDark } from "../theme-toggle";
import { HerePill } from "../here-pill";
import type { Here } from "@/lib/here-shared";

// MapLibre touches `window` on import, so the map only loads in the browser. Its download
// starts as soon as this page's script runs, not when the map first renders.
const loadEarthMap = () => import("../earth/earth-map");
/** Phones, and any screen too short for the full layout (a phone on its side): the compact globe page (the `compact:` variant). */
const COMPACT = "(max-width: 639px), (max-height: 520px)";
const EarthMap = dynamic(() => loadEarthMap().then((m) => m.EarthMap), { ssr: false, loading: () => null });

type ViewMode = "globe" | "map" | "list";
type GeoAnswer = { clusters: Cluster[]; total: number; inView: number; demoOnly?: boolean; /** The server was still loading its catalogue. */ partial?: boolean };
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

export function DiscoverClient() {
  // The globe's code (1 MB) starts loading as this page first renders, not when another page
  // merely prefetches this one (the logo links here from every page).
  if (typeof window !== "undefined") void loadEarthMap();
  const user = useUser();
  const reduced = useReducedMotion();
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [mode, setMode] = useState<ViewMode>("globe");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [view, setView] = useState<ViewState>(HOME);
  const [initialView, setInitialView] = useState<CameraState | null>(null);
  const [flyTo, setFlyTo] = useState<FlyRequest>();
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [counts, setCounts] = useState<{ total: number; inView: number; key: string } | null>(null);
  const [demoOnly, setDemoOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [place, setPlace] = useState<SelectedPlace | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [base, setBase] = useState<BaseStyle>("map");
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [space, setSpace] = useState(false);
  const [intro, setIntro] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  // Where the visitor is (their choice, else their connection's city): the globe turns to face
  // it as it arrives, and "Happening soon" lists what's on there.
  // undefined while it's being found (briefly: the lists wait for it, at most a couple of seconds).
  const [here, setHere] = useState<Here | null | undefined>(undefined);
  const linkedView = useRef(false);
  useEffect(() => {
    const late = setTimeout(() => setHere((h) => (h === undefined ? null : h)), 2500);
    fetch("/api/here")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { here: Here } | null) => setHere(j?.here ?? null))
      .catch(() => setHere(null))
      .finally(() => clearTimeout(late));
    return () => clearTimeout(late);
  }, []);
  const [mapReady, setMapReady] = useState(false);
  // Where the camera really is (the view state pauses while the planet turns), for the glow.
  const [cam, setCam] = useState<{ zoom: number; lat: number } | null>(null);
  // On large screens the side panel takes the right: the map centres in the room left of it.
  const [padRight, setPadRight] = useState(0);
  useEffect(() => {
    const on = () => setPadRight(window.innerWidth >= 1024 ? 400 : 0);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  // Phones: the search at the top and the controls at the bottom leave the planet the room
  // between them, and the globe is centred there (not behind them).
  const topBox = useRef<HTMLDivElement>(null);
  const bottomBox = useRef<HTMLDivElement>(null);
  const [phonePad, setPhonePad] = useState({ top: 0, bottom: 0 });
  useEffect(() => {
    const measure = () => {
      const r = root.current?.getBoundingClientRect();
      const t = topBox.current?.getBoundingClientRect();
      const b = bottomBox.current?.getBoundingClientRect();
      if (!window.matchMedia(COMPACT).matches || !r || !t || !b || !t.height || !b.height) return setPhonePad((p) => (p.top || p.bottom ? { top: 0, bottom: 0 } : p));
      const top = Math.max(0, Math.round(t.bottom - r.top + 6));
      const bottom = Math.max(0, Math.round(r.bottom - b.top + 6));
      setPhonePad((p) => (Math.abs(p.top - top) < 4 && Math.abs(p.bottom - bottom) < 4 ? p : { top, bottom }));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    [root.current, topBox.current, bottomBox.current].forEach((el) => el && ro?.observe(el));
    window.addEventListener("resize", measure);
    return () => (ro?.disconnect(), window.removeEventListener("resize", measure));
  }, []);
  // The map controls, whose icons say their names when tapped (TapLabel).
  const dockRef = useRef<HTMLDivElement>(null);
  // Phones: the tools that don't fit beside the timeline, in a sheet with their names.
  const [tools, setTools] = useState(false);
  // A first-visit hint on how to handle the globe; gone at the first touch or after a while.
  const [hint, setHint] = useState(true);
  useEffect(() => {
    if (!mapReady) return;
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, [mapReady]);
  const [mapFailure, setMapFailure] = useState<string | null>(null);
  const [mapKey, setMapKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [interp, setInterp] = useState<ParsedQuery | null>(null);
  const [retry, setRetry] = useState(0);
  const [pickMode, setPickMode] = useState(false);
  const [hovered, setHovered] = useState<{ lat: number; lng: number } | null>(null);
  const [focusedVenue, setFocusedVenue] = useState<string | null>(null);
  // "Spin the globe": open while its panel shows; each press of a spin button bumps the token.
  const [spinOpen, setSpinOpen] = useState(false);
  const [spinToken, setSpinToken] = useState(0);
  // "Night Flight": the cinematic tour; the planet turns again at its finale.
  const [flightOn, setFlightOn] = useState(false);
  const [flightSpin, setFlightSpin] = useState(false);
  const [flightGrab, setFlightGrab] = useState(0);
  const spaceBefore = useRef(false);
  const baseBefore = useRef<BaseStyle>("map");
  // Whether the visitor picked the map style themselves. Until they do, it follows the site's
  // theme: the day map in light mode, the Earth at night in dark mode.
  const baseChosen = useRef(false);
  const dark = useDark();
  const flightAsked = useRef(false);
  const spinAsked = useRef(false);
  const flyKey = useRef(0);
  const history = useRef<CameraState[]>([]);
  const mapApi = useRef<EarthMapHandle>(null);
  const root = useRef<HTMLDivElement>(null);

  // ---- boot: read URL + saved map preferences once, detect WebGL ----
  useEffect(() => {
    const ok = hasWebGL();
    setWebgl(ok);
    const sp = new URLSearchParams(window.location.search);
    const p = parseFilterParams(new URLSearchParams([...sp].filter(([k]) => !["v", "at", "view", "pin", "style", "flight", "spin"].includes(k))));
    // A shared Night Flight link takes off as soon as the globe is ready.
    flightAsked.current = sp.get("flight") === "1" && ok;
    // A link (or the command menu) can ask for a spin as soon as the globe is ready.
    spinAsked.current = sp.get("spin") === "1" && ok;
    if (p.ok) setFilters(p.filters);
    const narrow = window.innerWidth < 640;
    // The whole planet, as big as the screen allows.
    // Phones: sized to the room between the search and the controls (about 175 px of them,
    // and the bottom bar), so the planet fills the width.
    const phone = window.matchMedia(COMPACT).matches;
    let iv: CameraState = { ...HOME, zoom: fitGlobeZoom(window.innerWidth - (window.innerWidth >= 1024 ? 400 : 0), phone ? window.innerHeight - 58 - 175 + 80 : window.innerHeight) };
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
      if (isBaseStyle(saved?.base) && saved?.chosen) {
        setBase(saved.base);
        baseChosen.current = true;
      } else if (isDarkNow()) setBase("lights");
      if (saved?.space === true) setSpace(true);
      if (saved?.layers) setLayers({ ...DEFAULT_LAYERS, ...saved.layers, ...(narrow ? { terrain: false } : {}) });
      else if (narrow) setLayers({ ...DEFAULT_LAYERS, terrain: false });
    } catch {
      // storage unavailable
    }
    if (isBaseStyle(sp.get("style"))) {
      setBase(sp.get("style") as BaseStyle);
      baseChosen.current = true;
    }
    const m = sp.get("view") as ViewMode | null;
    setMode(!ok ? "list" : m === "map" || m === "list" ? m : "globe");
    linkedView.current = !!(sp.get("at") || sp.get("v") || sp.get("pin"));
    if (sp.get("at") || sp.get("v") || sp.get("pin")) setAutoRotate(false);
    // A fresh visit arrives from deep space; shared links open right where they point.
    else setIntro(true);
  }, []);

  // Switching the site's theme turns the globe to night or day too, unless a style was picked.
  useEffect(() => {
    if (dark === null || baseChosen.current || flightOn) return;
    setBase(dark ? "lights" : "map");
  }, [dark]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      // A flight turns space view on for itself; the visitor's own choice is what's kept.
      localStorage.setItem(PREFS_KEY, JSON.stringify({ base: flightOn ? baseBefore.current : base, chosen: baseChosen.current, layers, space: flightOn ? spaceBefore.current : space }));
    } catch {
      // storage unavailable
    }
  }, [base, layers, space, flightOn]);

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
  /** The visible area as URL parameters ("" when the whole planet is in view). */
  const viewQuery = radius == null ? "" : `vlat=${view.lat.toFixed(4)}&vlng=${view.lng.toFixed(4)}&vr=${Math.ceil(radius)}`;
  const geoQuery = (fk: string) => [fk, `cell=${cell}&z=${zKey}`, viewQuery].filter(Boolean).join("&");

  // Answers for the globe are kept for two minutes, so going back to a view or a day (or a
  // day fetched ahead by the timeline) shows its events at once.
  const geoCache = useRef(new Map<string, { at: number; data: GeoAnswer }>());
  const geoInflight = useRef(new Map<string, Promise<GeoAnswer>>());
  const loadGeo = useCallback((qs: string, signal?: AbortSignal): Promise<GeoAnswer> => {
    const hit = geoCache.current.get(qs);
    if (hit && Date.now() - hit.at < 120000) return Promise.resolve(hit.data);
    const pending = geoInflight.current.get(qs);
    if (pending) return pending;
    const p = fetch(`/api/geo?${qs}`, { signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
        }
        return (await res.json()) as GeoAnswer;
      })
      .then((data) => {
        // An answer from a server still loading isn't kept: the next look asks again.
        if (data.partial) return data;
        const c = geoCache.current;
        c.delete(qs);
        c.set(qs, { at: Date.now(), data });
        if (c.size > 80) c.delete(c.keys().next().value!);
        return data;
      })
      .finally(() => geoInflight.current.delete(qs));
    // Requests that can be cancelled (the current view's) aren't shared with prefetches.
    if (!signal) geoInflight.current.set(qs, p);
    return p;
  }, []);

  const fetchedOnce = useRef(false);
  const partialTries = useRef(0);
  const [geoAgain, setGeoAgain] = useState(0);
  useEffect(() => {
    if (!initialView || mode === "list") return;
    const qs = geoQuery(filterKey);
    const show = (json: GeoAnswer) => {
      setClusters(json.clusters);
      setCounts({ total: json.total, inView: json.inView, key: filterKey });
      setDemoOnly(!!json.demoOnly);
      setError(null);
    };
    const hit = geoCache.current.get(qs);
    if (hit && Date.now() - hit.at < 120000) {
      show(hit.data);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    // The first load goes straight out; later ones wait for the camera or filters to settle,
    // unless the answer is already on its way (fetched ahead).
    const pending = geoInflight.current.has(qs);
    const wait = !fetchedOnce.current || pending ? 0 : 200;
    fetchedOnce.current = true;
    const t = setTimeout(async () => {
      setLoading(true);
      // Nothing yet from a server still loading isn't "no events": it stays "Loading events".
      let stillLoading = false;
      try {
        const json = await loadGeo(qs, pending ? undefined : ctrl.signal);
        if (!ctrl.signal.aborted) {
          show(json);
          // Answered by a server that was still loading: look again shortly, until it's whole.
          if (json.partial && partialTries.current < 15) {
            partialTries.current++;
            stillLoading = json.total === 0;
            setTimeout(() => setGeoAgain((n) => n + 1), stillLoading ? 2500 : 4000);
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError" && !ctrl.signal.aborted) setError((e as Error).message);
      } finally {
        if (!ctrl.signal.aborted && !stillLoading) setLoading(false);
      }
    }, wait);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, filterKey, mode, initialView, retry, geoAgain]);

  /** Fetch the globe's events for these days in the current view ahead of time, three at a time. */
  const prefetchDays = useCallback(
    (days: string[]) => {
      const queue = days.map((d) => geoQuery(filtersToParams({ ...filters, live: undefined, from: d, to: d, page: undefined, sort: undefined }).toString()));
      const next = (): Promise<void> => {
        const qs = queue.shift();
        return qs ? loadGeo(qs).catch(() => undefined).then(next) : Promise.resolve();
      };
      for (let i = 0; i < 3; i++) void next();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters, viewKey, loadGeo],
  );

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
        setPlace({ lat: c.lat, lng: c.lng, name: c.feature.name, kind: c.feature.kind, zoom: c.feature.zoom, poi: c.feature.poi });
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
  const liveInView = useMemo(() => clusters.reduce((n, c) => n + (c.live ?? 0), 0), [clusters]);

  // ---- live hops: with "Live now" on, jump around the planet from one event on right now to the next
  const [liveList, setLiveList] = useState<EventCard[]>([]);
  const hopAt = useRef(0);
  const liveKey = filters.live ? filtersToParams({ ...filters, near: undefined, nearLabel: undefined, page: undefined, sort: undefined }).toString() : "";
  useEffect(() => {
    setLiveList([]);
    hopAt.current = 0;
    if (!liveKey) return;
    const ctrl = new AbortController();
    fetch(`/api/events?${liveKey}&size=60`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { items: EventCard[] }) => {
        // Shuffled, so each hop lands somewhere unexpected.
        const items = [...j.items];
        for (let i = items.length - 1; i > 0; i--) {
          const k = Math.floor(Math.random() * (i + 1));
          [items[i], items[k]] = [items[k], items[i]];
        }
        setLiveList(items);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [liveKey]);
  const hopLive = useCallback(() => {
    if (!liveList.length) return;
    const c = liveList[hopAt.current++ % liveList.length];
    setPlace(null);
    setSelection({ kind: "event", card: c });
    fly({ lat: c.lat, lng: c.lng, zoom: 12.5 });
  }, [liveList, fly]);
  const nFilters = activeFilterCount(filters);

  const startSpin = () => {
    setSelection(null);
    setPlace(null);
    setPickMode(false);
    setShowFilters(false);
    if (mode === "list") setMode("globe");
    setSpinOpen(true);
    setSpinToken((t) => t + 1);
  };
  const spinTo = useCallback((lat: number, lng: number) => {
    setAutoRotate(false);
    setHovered(null);
    // Land where the spin panel doesn't cover: left of it on large screens, above it on phones.
    const offset: [number, number] = window.innerWidth >= 1024 ? [0, 0] : [0, -Math.round(window.innerHeight * 0.2)];
    return mapApi.current?.spinTo(lat, lng, 12.5, { offset }) ?? Promise.resolve(true);
  }, []);
  const onSpinLand = useCallback((c: EventCard) => setHovered({ lat: c.lat, lng: c.lng }), []);
  const closeSpin = useCallback(() => (setSpinOpen(false), setHovered(null)), []);

  const startFlight = () => {
    setSelection(null);
    setPlace(null);
    setPickMode(false);
    setShowFilters(false);
    setShowLayers(false);
    setShowLegend(false);
    setSpinOpen(false);
    setHovered(null);
    setHint(false);
    setAutoRotate(false);
    if (mode === "list") setMode("globe");
    if (!flightOn) {
      spaceBefore.current = space;
      baseBefore.current = base;
    }
    // Night falls: the starry sky, the Earth's city lights and its real night side, for the whole flight.
    setSpace(true);
    setBase("lights");
    setFlightOn(true);
  };
  const exitFlight = useCallback(() => {
    setFlightOn(false);
    setFlightSpin(false);
    setHovered(null);
    setSpace(spaceBefore.current);
    setBase(baseBefore.current);
  }, []);
  const getMap = useCallback(() => mapApi.current, []);
  const onFlightStop = useCallback((c: EventCard | null) => setHovered(c ? { lat: c.lat, lng: c.lng } : null), []);
  const onFlightOpen = useCallback(
    (c: EventCard) => {
      exitFlight();
      setSelection({ kind: "event", card: c });
      fly({ lat: c.lat, lng: c.lng, zoom: 13 });
    },
    [exitFlight, fly],
  );
  useEffect(() => {
    if (!mapReady) return;
    if (flightAsked.current) {
      flightAsked.current = false;
      startFlight();
    } else if (spinAsked.current) {
      spinAsked.current = false;
      startSpin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // The bottom bar's globe, tapped on this page: the whole planet again.
  useEffect(() => {
    const home = () => {
      setSelection(null);
      setPlace(null);
      setTools(false);
      if (mode === "list") setMode("globe");
      const w = window.innerWidth - (window.innerWidth >= 1024 ? 400 : 0);
      fly({ ...HOME, zoom: fitGlobeZoom(w, window.innerHeight - phonePad.top - phonePad.bottom + 80) });
    };
    window.addEventListener("omni:globe", home);
    return () => window.removeEventListener("omni:globe", home);
  });

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

  const phoneRoom = !flightOn && mode !== "list" ? phonePad : { top: 0, bottom: 0 };
  const projection = mode === "map" ? "mercator" : "globe";
  const showMap = mode !== "list" && webgl && initialView && !mapFailure;
  const tilted = view.pitch > 10;

  return (
    <div ref={root} style={{ "--map-bottom-pad": `${phoneRoom.bottom}px` } as React.CSSProperties} className={`globe-stage relative h-[calc(100dvh-var(--tabbar-h))] w-full overflow-hidden sky ${(space || base === "lights") && mode !== "list" ? "space" : ""}`}>
      {loading && mode !== "list" && <div className="map-progress z-50" aria-hidden />}
      {/* ---------- Stage: one map engine, two projections ---------- */}
      {/* Behind the planet: a glow of light and a soft shadow below, so it floats. */}
      {mode === "globe" && mapReady && cam && !flightOn && <GlobeAura zoom={cam.zoom} lat={cam.lat} space={space || base === "lights"} shift={padRight} room={phoneRoom} />}
      {mode === "globe" && mapReady && cam && hint && !selection && !place && !spinOpen && !flightOn && <GlobeHint zoom={cam.zoom} lat={cam.lat} shift={padRight} room={phoneRoom} />}
      <div className="absolute inset-0" aria-hidden={mode === "list"}>
        {showMap && (
          <EarthMap
            key={mapKey}
            ref={mapApi}
            className="absolute inset-0"
            ariaLabel="Interactive map of Earth with events. Drag to move, scroll or pinch to zoom, right-drag or two fingers to tilt and rotate. Arrow keys pan and plus or minus zoom when the map is focused. Use the list view for full keyboard access to every event."
            initial={here?.city && !linkedView.current ? { ...initialView!, lat: Math.max(-30, Math.min(48, here.city.lat * 0.8)), lng: here.city.lng } : initialView!}
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
            framePadding={typeof window !== "undefined" && window.innerWidth >= 1024 ? { top: 200, right: 40, bottom: 110, left: 60 } : { top: 190, right: 30, bottom: Math.round((typeof window !== "undefined" ? window.innerHeight : 800) * 0.5), left: 30 }}
            flyTo={flyTo}
            autoRotate={flightOn ? flightSpin : autoRotate && !selection && !place && !filters.near && !pickMode && mode === "globe"}
            reducedMotion={reduced}
            space={space}
            intro={intro}
            onView={setView}
            onClusterClick={onClusterClick}
            onMapClick={onMapClick}
            onUserInteract={() => (setAutoRotate(false), setHint(false), flightOn && setFlightGrab((g) => g + 1))}
            onCamera={(zoom, lat) => setCam((c) => (c && Math.abs(c.zoom - zoom) < 0.02 && Math.abs(c.lat - lat) < 1 ? c : { zoom, lat }))}
            padRight={padRight}
            padTop={phoneRoom.top}
            padBottom={flightOn ? flightPadBottom() : phoneRoom.bottom}
            onReady={() => (setMapReady(true), setIntro(false))}
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
      <div className={`pointer-events-none absolute inset-x-0 top-[var(--header-h)] compact:top-[calc((var(--header-h)-3rem)/2)] z-20 px-4 compact:px-3 sm:px-6 lg:pr-[400px] ${flightOn ? "hidden" : ""}`}>
        {/* A compact column in the corner: the globe is the page. On phones, the search shares
            the top row with the account button and one row of chips follows: nothing else. */}
        <div ref={topBox} className="max-w-[min(34rem,100%)]">
          <div className="pointer-events-auto">
            <h1 className={`text-balance on-sky compact:sr-only ${view.zoom > 4 || place || mode === "list" ? "sr-only" : ""}`}>
              <span className="block t-hero">One planet. <em className="text-white/85">Every experience.</em></span>
              <span className="max-sm:sr-only block font-medium text-[0.9375rem] leading-snug mt-1.5 text-white/90">
                Spin it, tap a glowing marker, or ask for anything.
              </span>
            </h1>
            {!(view.zoom > 4 || place || mode === "list") && (
              <div className="hero-ctas mt-3 flex items-center gap-2 compact:hidden sm:flex-wrap">
                {here && (
                  <div className="lg:hidden shrink-0">
                    <HerePill here={here} tone="glass" onChange={(h) => {
                      setHere(h);
                      if (h.city) fly({ lat: h.city.lat, lng: h.city.lng, zoom: 10.5 });
                    }} />
                  </div>
                )}
                <button type="button" onClick={startSpin} className="spin-cta press inline-flex items-center gap-2 rounded-full px-4 py-2 t-small font-bold text-on-sun hover:brightness-105">
                  <span className="spin-cta-die text-lg leading-none" aria-hidden>🎲</span> Spin the globe
                </button>
                <button type="button" onClick={startFlight} className="nf-cta press inline-flex items-center gap-2 rounded-full px-4 py-2 t-small font-bold">
                  <Plane size={15} className="text-[var(--gold-light)]" aria-hidden /> Night Flight
                </button>
                <Link href="/mixtape" className="mx-cta press inline-flex items-center gap-2 rounded-full px-4 py-2 t-small font-bold">
                  <span className="mx-cta-tape" aria-hidden>📼</span> Mixtape <span className="nf-cta-new" aria-label="new">NEW</span>
                </Link>
              </div>
            )}
            <SearchBox
              className="mt-3.5 compact:mt-0 compact:mr-[5.75rem]"
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

          <div className="pointer-events-auto mt-3 compact:mt-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1" role="group" aria-label="Event categories">
            {here && (
              <div className="hidden compact:block shrink-0">
                <HerePill here={here} tone="glass" onChange={(h) => {
                  setHere(h);
                  if (h.city) fly({ lat: h.city.lat, lng: h.city.lng, zoom: 10.5 });
                }} />
              </div>
            )}
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
        <section className="absolute z-40 inset-x-0 bottom-0 max-h-[80dvh] sm:inset-auto sm:left-6 sm:top-[calc(var(--header-h)+12rem)] sm:bottom-6 sm:w-[380px] sm:max-h-none surface-float rounded-t-[var(--radius-l)] sm:rounded-[var(--radius-l)] flex flex-col panel-in" aria-label="Filters">
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
        </section>
      )}

      {/* ---------- List mode ---------- */}
      {mode === "list" && (
        <ListMode filters={filters} view={view} onSelect={(c) => setSelection({ kind: "event", card: c })} />
      )}

      {/* ---------- Bottom-left: view switch and map controls ---------- */}
      <div ref={bottomBox} className={`absolute z-20 left-4 sm:left-6 compact:left-3 compact:right-3 flex flex-col gap-2 items-start ${near && !selection ? "bottom-[13.5rem] lg:bottom-8" : "bottom-8 compact:bottom-3"} ${flightOn ? "hidden" : ""}`}>
        {showLayers && mode !== "list" && (
          <LayersPanel base={base} layers={layers} onBase={(b) => {
            baseChosen.current = true;
            setBase(b);
          }} onLayer={(k, on) => setLayers((l) => ({ ...l, [k]: on }))} onClose={() => setShowLayers(false)} space={space} onSpace={setSpace} onLegend={() => (setShowLayers(false), setShowLegend(true))} />
        )}
        {mode !== "list" && filters.live && liveList.length > 0 && !selection && (
          <button type="button" onClick={hopLive} className="press panel-in inline-flex items-center gap-2 rounded-full bg-live text-white px-4 h-9 text-[13.5px] font-semibold shadow-[0_10px_24px_-10px_rgb(225_29_72_/_0.8)] hover:brightness-110">
            <span className="live-dot live-dot--on" aria-hidden /> Jump to something on right now <span aria-hidden>→</span>
          </button>
        )}
        {mode !== "list" && (
          // Phones: the timeline and two round buttons share one row (spin, and the other tools).
          <div className="flex items-end gap-2 compact:w-full">
          <div className="min-w-0 compact:flex-1">
          <TimeBar
            filters={filters}
            onChange={(patch) => setFilters((f) => ({ ...f, ...patch, page: undefined }))}
            live={liveInView}
            count={counts && counts.key === filterKey ? counts.inView : null}
            ready={!!counts && counts.key === filterKey && !loading}
            baseQuery={filtersToParams({ ...filters, live: undefined, from: undefined, to: undefined, page: undefined, sort: undefined }).toString()}
            viewQuery={radius == null ? "" : `vlat=${view.lat.toFixed(2)}&vlng=${view.lng.toFixed(2)}&vr=${Math.ceil(radius / 10) * 10}`}
            prefetch={prefetchDays}
            reduced={reduced}
          />
          </div>
          <div className="hidden compact:flex items-center gap-1.5 shrink-0 pb-px">
            <button type="button" className="phone-tool phone-tool--spin press" aria-label="Spin the globe: land on a random event" onClick={startSpin}>
              <Dices size={19} aria-hidden />
            </button>
            <button type="button" className="phone-tool press" aria-label="Map tools" aria-expanded={tools} onClick={() => setTools((t) => !t)}>
              <Ellipsis size={19} aria-hidden />
            </button>
          </div>
          </div>
        )}
        {showLegend && mode !== "list" && !showLayers && <LegendPanel onClose={() => setShowLegend(false)} />}
        {/* One slim glass dock: view, camera and map tools as icons, their names on hover. */}
        <TapLabel within={dockRef} />
        <div ref={dockRef} className="glass-dock compact:hidden flex items-center gap-0.5 rounded-full p-1 max-w-[calc(100vw-2rem)] overflow-x-auto no-scrollbar" role="toolbar" aria-label="Map controls">
          <div className="flex items-center gap-0.5" role="radiogroup" aria-label="View">
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
                aria-label={label}
                disabled={m !== "list" && webgl === false}
                title={m !== "list" && webgl === false ? "Maps need WebGL, which isn't available on this device" : label}
                onClick={() => {
                  // The list replaces the map; coming back, the map reopens where it was left.
                  if (m === "list" && mode !== "list") setInitialView(mapApi.current?.getCamera() ?? view);
                  setMode(m);
                }}
                className="dock-btn"
              >
                <Icon size={16} aria-hidden />
              </button>
            ))}
          </div>
          {mode !== "list" && (
            <>
              <span className="dock-sep" aria-hidden />
              {/* Phones pinch to zoom and use two fingers to tilt or turn, so those buttons are for larger screens. */}
              <button type="button" className="dock-btn max-sm:hidden" aria-label="Zoom in" title="Zoom in" onClick={() => mapApi.current?.zoomBy(1)}>
                <Plus size={16} aria-hidden />
              </button>
              <button type="button" className="dock-btn max-sm:hidden" aria-label="Zoom out" title="Zoom out" onClick={() => mapApi.current?.zoomBy(-1)}>
                <Minus size={16} aria-hidden />
              </button>
              <button type="button" className="dock-btn max-sm:hidden" aria-pressed={tilted} aria-label={tilted ? "Look straight down" : "Tilt for a 3D perspective"} title={tilted ? "Look straight down" : "Tilt for a 3D perspective"} onClick={() => mapApi.current?.setPitch(tilted ? 0 : 60)}>
                <Mountain size={16} aria-hidden />
              </button>
              <button type="button" className={`dock-btn ${Math.abs(view.bearing) < 1 ? "max-sm:hidden" : ""}`} aria-label="Point north" title={`Point north (heading ${Math.round(view.bearing)}°)`} onClick={() => mapApi.current?.resetNorth()}>
                <Compass size={16} aria-hidden style={{ transform: `rotate(${-view.bearing}deg)` }} />
              </button>
              {mode === "globe" && (
                <button type="button" className="dock-btn" aria-pressed={autoRotate && !reduced} aria-label={autoRotate ? "Stop auto-rotation" : "Start auto-rotation"} title={autoRotate ? "Stop turning" : "Let the planet turn"} onClick={() => (setAutoRotate((a) => !a), autoRotate ? null : (setPlace(null), setSelection(null)))} disabled={reduced}>
                  {autoRotate && !reduced ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
                </button>
              )}
              <button type="button" className="dock-btn" aria-label="Reset to whole-planet view" title="Whole planet" onClick={() => (setSelection(null), setPlace(null), fly({ ...HOME, zoom: fitGlobeZoom(window.innerWidth - padRight, window.innerHeight) }))}>
                <RotateCcw size={15} aria-hidden />
              </button>
              <span className="dock-sep" aria-hidden />
              <button type="button" className="dock-btn dock-btn--spin" aria-label="Spin the globe" title="Spin the globe: land on a random event somewhere in the world" onClick={startSpin}>
                <Dices size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="dock-btn"
                aria-pressed={pickMode || !!near}
                aria-label={near ? `Search area: ${formatKm(near.radiusKm)}` : "Explore an area"}
                title="Pick a point on the map and search a radius around it"
                onClick={() => (near && !pickMode ? setPickMode(true) : setPickMode((p) => !p))}
              >
                <Crosshair size={16} aria-hidden />
                {near && <span className="text-[12px] font-semibold tnum pr-1">{formatKm(near.radiusKm)}</span>}
              </button>
              <button type="button" className="dock-btn" aria-label="Show events near me" title="Events near me (your location is not stored)" onClick={locate}>
                <LocateFixed size={16} aria-hidden />
              </button>
              <button type="button" className="dock-btn" aria-pressed={showLayers} aria-label="Layers" title="Map layers: style, terrain, borders, labels" onClick={() => (setShowLegend(false), setShowLayers((v) => !v))}>
                <Layers size={16} aria-hidden />
              </button>
              <button type="button" className="dock-btn max-sm:hidden" aria-label={fullscreen ? "Exit full screen" : "Full screen"} title={fullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>
                {fullscreen ? <Minimize size={15} aria-hidden /> : <Maximize size={15} aria-hidden />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ---------- Phones: map tools, each with its name ---------- */}
      {tools && mode !== "list" && !flightOn && (
        <>
          <button type="button" className="absolute inset-0 z-30 bg-black/25" aria-label="Close map tools" tabIndex={-1} onClick={() => setTools(false)} />
          <section className="phone-tools-sheet panel-in" role="dialog" aria-modal="true" aria-label="Map tools">
            <div className="flex items-center justify-between mb-2">
              <p className="t-h3">Map tools</p>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={() => setTools(false)}>
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-full bg-panel-2 mb-3" role="radiogroup" aria-label="View">
              {([["globe", Globe2, "Globe"], ["map", MapIcon, "Map"], ["list", List, "List"]] as const).map(([m, Icon, label]) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={m !== "list" && webgl === false} className="phone-seg" onClick={() => {
                  if (m === "list") setInitialView(mapApi.current?.getCamera() ?? view);
                  setMode(m);
                  setTools(false);
                }}>
                  <Icon size={16} aria-hidden /> {label}
                </button>
              ))}
            </div>
            <ul className="grid grid-cols-2 gap-2">
              {mode === "globe" && (
                <li><button type="button" className="phone-tile" disabled={reduced} onClick={() => (setAutoRotate((a) => !a), setTools(false))}>{autoRotate && !reduced ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}{autoRotate && !reduced ? "Stop turning" : "Let it turn"}</button></li>
              )}
              <li><button type="button" className="phone-tile" onClick={() => (setSelection(null), setPlace(null), fly({ ...HOME, zoom: fitGlobeZoom(window.innerWidth, window.innerHeight - phonePad.top - phonePad.bottom + 80) }), setTools(false))}><RotateCcw size={18} aria-hidden /> Whole planet</button></li>
              <li><button type="button" className="phone-tile" onClick={() => (locate(), setTools(false))}><LocateFixed size={18} aria-hidden /> Near me</button></li>
              <li><button type="button" className="phone-tile" onClick={() => (setPickMode(true), setTools(false))}><Crosshair size={18} aria-hidden /> Explore an area</button></li>
              <li><button type="button" className="phone-tile" onClick={() => (setShowLegend(false), setShowLayers(true), setTools(false))}><Layers size={18} aria-hidden /> Map layers</button></li>
              <li><button type="button" className="phone-tile" onClick={() => (setTools(false), startFlight())}><Plane size={18} aria-hidden /> Night Flight</button></li>
              <li><Link href="/mixtape" className="phone-tile" onClick={() => setTools(false)}><span aria-hidden>📼</span> Mixtape</Link></li>
              <li><button type="button" className="phone-tile" onClick={() => (setTools(false), startSpin())}><Dices size={18} aria-hidden /> Spin the globe</button></li>
            </ul>
          </section>
        </>
      )}

      {/* ---------- Status line ---------- */}
      <div className={`absolute z-10 right-4 sm:right-6 bottom-8 text-right t-micro text-white/85 [text-shadow:0_1px_2px_rgb(10_30_80_/_0.45)] tnum pointer-events-none ${mode === "list" || flightOn ? "hidden" : "hidden md:block"}`} aria-live="polite">
        {loading ? "Loading events" : counts ? `${counts.inView.toLocaleString()} of ${counts.total.toLocaleString()} matching events in view` : ""}
        {!loading && liveInView > 0 && !filters.live && (
          <div className="mt-0.5 flex items-center justify-end gap-1.5 font-semibold text-white">
            <span className="live-dot" aria-hidden /> {liveInView.toLocaleString()} on right now
          </div>
        )}
        {demoOnly && <div className="mt-0.5 text-[#ffd98a]">Demo mode: all events shown are fictional</div>}
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

      {/* ---------- Right: night flight, spin, selection, place, or discovery ---------- */}
      {flightOn && mode !== "list" ? (
        <NightFlight
          map={getMap}
          ready={mapReady}
          reduced={reduced}
          interrupt={flightGrab}
          onStop={onFlightStop}
          onFinale={setFlightSpin}
          onOpen={onFlightOpen}
          onExit={exitFlight}
        />
      ) : spinOpen && mode !== "list" ? (
        <GlobeSpin
          token={spinToken}
          ready={mapReady}
          reduced={reduced}
          spin={spinTo}
          onLand={onSpinLand}
          onClose={closeSpin}
          onOpen={(c) => {
            closeSpin();
            setSelection({ kind: "event", card: c });
            fly({ lat: c.lat, lng: c.lng, zoom: 13 });
          }}
        />
      ) : selection ? (
        <SelectionPanel
          selection={selection}
          filters={filters}
          onClose={() => setSelection(null)}
          onSelectEvent={(c) => {
            setSelection({ kind: "event", card: c, from: selection.kind === "cluster" ? selection.cluster : undefined });
            if (view.zoom < 9 && !filters.near) fly({ lat: c.lat, lng: c.lng, zoom: 13 });
          }}
          onBack={selection.kind === "event" && selection.from ? () => setSelection({ kind: "cluster", cluster: selection.from! }) : undefined}
          onNextLive={filters.live && liveList.length > 1 && selection.kind === "event" ? hopLive : undefined}
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
        mode !== "list" && <DiscoveryPanel filters={filters} here={here} onHere={(h) => {
          setHere(h);
          if (h.city) fly({ lat: h.city.lat, lng: h.city.lng, zoom: 10.5 });
        }} interests={user.prefs.interests} onHover={peek} onPick={(c) => (setHovered(null), clearTimeout(peekTimer.current), setSelection({ kind: "event", card: c }), fly({ lat: c.lat, lng: c.lng, zoom: 13 }))} onCity={(id) => {
          const d = getDestination(id);
          if (d) fly({ lat: d.lat, lng: d.lng, zoom: 10.5 });
          setFilters((f) => ({ ...f, city: id, country: undefined, continent: undefined }));
        }} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ pieces

/**
 * Light behind the planet and a soft shadow beneath it, sized to the globe on screen. Only
 * while the whole planet is in view; drawn under the map, which is clear around the globe.
 */
function GlobeAura({ zoom, lat, space, shift, room }: { zoom: number; lat: number; space: boolean; shift: number; room: { top: number; bottom: number } }) {
  const r = globeRadiusPx(zoom, lat);
  if (zoom > 3.2 || !Number.isFinite(r)) return null;
  return (
    <div className="pointer-events-none absolute left-0 overflow-visible" style={{ right: shift, top: room.top, bottom: room.bottom }} aria-hidden>
      <div className={`globe-halo ${space ? "globe-halo--space" : ""}`} style={{ width: r * 2.9, height: r * 2.9 }} />
      <div className="globe-shadow" style={{ width: r * 1.5, height: r * 0.2, transform: `translate(-50%, ${r * 1.04}px)` }} />
    </div>
  );
}

/** How to handle the globe, shown on its lower part for a first-time visitor. */
function GlobeHint({ zoom, lat, shift, room }: { zoom: number; lat: number; shift: number; room: { top: number; bottom: number } }) {
  const [touch, setTouch] = useState(false);
  useEffect(() => setTouch(window.matchMedia("(pointer: coarse)").matches), []);
  const r = globeRadiusPx(zoom, lat);
  if (zoom > 3.2 || !Number.isFinite(r)) return null;
  return (
    <p className="globe-hint pointer-events-none absolute z-10 left-1/2 glass-dock rounded-full px-3.5 py-1.5 t-micro font-semibold text-text whitespace-nowrap" style={{ top: `calc(${room.top}px + (100% - ${room.top + room.bottom}px) / 2 + ${Math.round(r * 0.66)}px)`, left: `calc(50% - ${shift / 2}px)` }} role="note">
      <span aria-hidden>👆</span> Drag to spin · {touch ? "Pinch" : "Scroll"} to zoom · Tap a glowing marker
    </p>
  );
}

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

/** What the markers mean: a shape and colour per kind of event, and what a number says. */
function LegendPanel({ onClose }: { onClose: () => void }) {
  const groups = ["music", "sports", "theatre", "festivals", "conferences", "exhibitions", "attractions", "family"];
  return (
    <div className="glass-dock rounded-[var(--radius-m)] p-3 panel-in w-[min(300px,calc(100vw-2rem))]" role="dialog" aria-label="Legend">
      <div className="flex items-center justify-between">
        <p className="t-small font-semibold">Legend</p>
        <button type="button" className="dock-btn !h-7 !min-w-7" aria-label="Close legend" onClick={onClose}><X size={14} aria-hidden /></button>
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {groups.map((g) => (
          <li key={g} className="flex items-center gap-2 t-micro text-text-2">
            <ShapeGlyph group={g} size={18} />
            {GROUPS.find((x) => x.slug === g)?.name.split(" &")[0]}
          </li>
        ))}
        <li className="col-span-2 t-micro text-text-3 mt-1">Numbered markers group several events; the coloured ring shows how much of the group is its main category. Zoom in to separate them.</li>
      </ul>
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
  const when = cardWhen(c).replace(/, \d\d:\d\d$/, "");
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
            <span className="absolute left-1.5 bottom-1.5 inline-flex items-center gap-1.5 rounded-full bg-text/85 px-1.5 py-0.5 text-[11px] font-semibold tnum text-on-ink backdrop-blur">
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

/**
 * Eight to show from a longer list: ones with a picture first and, when the list is for the
 * whole world, no more than three from one city (a busy morning in one place doesn't fill the
 * panel). Otherwise in the list's order.
 */
function showcase(list: EventCard[], n: number, spread: boolean): EventCard[] {
  const perCity = new Map<string, number>();
  const pick: EventCard[] = [];
  for (const pass of [true, false])
    for (const c of list) {
      if (pick.length >= n) break;
      if (!!c.imageUrl !== pass || pick.includes(c)) continue;
      const k = c.cityId ?? c.city;
      if (spread && pass && (perCity.get(k) ?? 0) >= 3) continue;
      perCity.set(k, (perCity.get(k) ?? 0) + 1);
      pick.push(c);
    }
  return pick;
}

function DiscoveryPanel({ filters, here, onHere, interests, onPick, onCity, onHover }: { filters: SearchFilters; here: Here | null | undefined; onHere: (h: Here) => void; interests: string[]; onPick: (c: EventCard) => void; onCity: (id: string) => void; onHover: (c: EventCard | null) => void }) {
  const [open, setOpen] = useState(true);
  // Lists open on the visitor's city unless the search already says where.
  const placed = !!(filters.city || filters.country || filters.continent || filters.near || filters.places?.length || filters.group);
  const near = !placed && here?.city ? here.city : null;
  const base = filtersToParams({ ...filters, city: near?.id ?? filters.city, from: undefined, to: undefined, page: undefined, sort: undefined });
  const wk = datePresets()[1];
  const weekend = new URLSearchParams(base);
  weekend.set("from", wk.from);
  weekend.set("to", wk.to);
  weekend.set("size", "24");
  const fresh = new URLSearchParams(filtersToParams({ ...filters, city: near?.id ?? filters.city, sort: "announced", page: undefined }));
  fresh.set("size", "24");
  const forYou = interests.length ? new URLSearchParams({ cat: interests.join(","), size: "24", status: "on_sale", ...(near ? { city: near.id } : {}) }) : null;
  const tabs = [
    ...(forYou ? [{ id: "you", label: "For you", params: forYou.toString(), empty: "Nothing on sale matches your interests right now." }] : []),
    { id: "weekend", label: "This weekend", params: weekend.toString(), empty: "Nothing this weekend matches your filters." },
    { id: "new", label: "New", params: fresh.toString(), empty: "No recent announcements match your filters." },
    { id: "buzz", label: "🔥 Buzzing", params: "buzz", empty: "Nothing yet. Say you're going to an event and it shows up here for everyone." },
  ];
  const [tab, setTab] = useState(tabs[0].id);
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];
  const { items: found, loading, error } = useEvents(here === undefined && active.id !== "buzz" ? null : active.params);
  const items = useMemo(() => (active.id === "buzz" ? found : showcase(found, 8, !placed && !near)), [found, active.id, placed, near]);
  const [cities, setCities] = useState<{ id: string; name: string; country?: string; stats?: { total: number } }[]>([]);
  useEffect(() => {
    fetch("/api/destinations")
      .then((r) => r.json())
      .then((j) => setCities(j.destinations.filter((d: { kind: string; stats?: { total: number } }) => d.kind === "city" && d.stats).sort((a: { stats: { total: number } }, b: { stats: { total: number } }) => b.stats.total - a.stats.total)))
      .catch(() => setCities([]));
  }, []);

  return (
    <section aria-label="Discover" className="absolute z-20 right-4 sm:right-6 top-[calc(var(--header-h)+0.5rem)] w-[360px] max-h-[calc(100dvh-var(--header-h)-5rem)] hidden lg:flex flex-col surface-float rounded-[var(--radius-l)] panel-slide">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        <button className="flex-1 flex items-center gap-1.5 text-left min-w-0" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="t-h3 truncate">Happening soon</span>
          {open ? <ChevronUp size={16} aria-hidden className="text-text-3 shrink-0" /> : <ChevronDown size={16} aria-hidden className="text-text-3 shrink-0" />}
        </button>
        {here && !placed && <HerePill here={here} align="right" onChange={onHere} />}
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
            <h2 className="t-h3 mb-2">Busiest cities</h2>
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
    </section>
  );
}

function SelectionPanel({ selection, filters, onClose, onSelectEvent, onBack, onNextLive }: { selection: NonNullable<Selection>; filters: SearchFilters; onClose: () => void; onSelectEvent: (c: EventCard) => void; onBack?: () => void; onNextLive?: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section
      aria-label={selection.kind === "event" ? "Event preview" : "Events here"}
      className="absolute z-30 inset-x-0 bottom-0 max-h-[72dvh] lg:inset-auto lg:right-6 lg:top-[calc(var(--header-h)+0.5rem)] lg:bottom-6 lg:w-[400px] lg:max-h-none surface-float rounded-t-[var(--radius-l)] lg:rounded-[var(--radius-l)] flex flex-col panel-slide"
    >
      <div className="lg:hidden mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
      {/* The panel stays put; its content slides in when the selection changes. */}
      <div key={selection.kind === "event" ? selection.card.id : selection.cluster.id} className="content-swap flex flex-col min-h-0 flex-1">
        {selection.kind === "event" ? (
          <EventPreview card={selection.card} onClose={onClose} onBack={onBack} backLabel={selection.from?.label} onNextLive={onNextLive} />
        ) : (
          <ClusterList cluster={selection.cluster} filters={filters} onClose={onClose} onPick={onSelectEvent} />
        )}
      </div>
    </section>
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
          {!!cluster.live && !filters.live && (
            <p className="mt-1 inline-flex items-center gap-1.5 t-small font-semibold text-live tnum">
              <span className="live-dot" aria-hidden /> {cluster.live.toLocaleString()} on right now
            </p>
          )}
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

function EventPreview({ card, onClose, onBack, backLabel, onNextLive }: { card: EventCard; onClose: () => void; onBack?: () => void; backLabel?: string; onNextLive?: () => void }) {
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
        {onBack ? (
          <button className="absolute left-2 top-2 btn btn-sm bg-panel/85 backdrop-blur text-text" onClick={onBack}>
            <ChevronLeft size={15} aria-hidden /> {backLabel ? `Back to ${backLabel}` : "Back"}
          </button>
        ) : onNextLive ? (
          <button className="absolute left-2 top-2 btn btn-sm press bg-live text-white shadow-md" onClick={onNextLive}>
            <span className="live-dot live-dot--on" aria-hidden /> Next live event <span aria-hidden>→</span>
          </button>
        ) : null}
        <div className="absolute left-3 bottom-2 flex gap-1.5">
          {card.isDemo && <DemoBadge />}
          <StatusBadge status={card.status} className="bg-panel/90" quiet />
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
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 pt-1">
          <Link href={`/events/${card.slug}`} className="btn btn-primary">View details</Link>
          {card.online ? <span /> : <TripButton card={card} title={card.title} className="btn-secondary" />}
          <SaveButton id={card.id} title={card.title} snap={snapOf(card)} />
          {offers.length > 0 && (
            <Link href={`/events/${card.slug}#tickets`} className="btn btn-secondary col-span-3">
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
