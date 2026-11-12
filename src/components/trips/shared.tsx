"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { EventCard } from "@/lib/types";
import type { Trip } from "@/lib/user/store";
import { tripSnapOf, type TripEvent } from "@/lib/trip-snap";
import { DEFAULT_LAYERS } from "@/lib/map/style";
import { codeOf, flagOf, nightsBetween, stopColor, type TripStop } from "@/lib/trip";
import type { EarthMapHandle, FlightRoute, FlyRequest, MapClick, PinHandle } from "../earth/earth-map";

const EarthMap = dynamic(() => import("../earth/earth-map").then((m) => m.EarthMap), {
  ssr: false,
  loading: () => <div className="trip-globe-loading" aria-hidden />,
});

// Places (restaurants, museums…) show as you zoom in, to put on the trip.
const LAYERS = { ...DEFAULT_LAYERS, terrain: false, density: false, poi: true };
/** While a trip plays as a show: no place icons, so its own places stand out. */
const QUIET = { ...LAYERS, poi: false };

export type Pad = { top: number; right: number; bottom: number; left: number };

const PHONE = "(max-width: 1023px)";

/**
 * Room the panels take over the globe: a column on the left (desktop) or the sheet below
 * (phones), measured as it is, so whatever the globe frames stays in the part left free.
 */
export function usePanelPad(panel?: RefObject<HTMLElement | null>): Pad {
  const [pad, setPad] = useState<Pad>({ top: 80, right: 60, bottom: 60, left: 60 });
  useEffect(() => {
    const on = () => {
      if (!window.matchMedia(PHONE).matches) return setPad({ top: 110, right: 80, bottom: 80, left: Math.min(520, window.innerWidth * 0.42) + 40 });
      const sheet = panel?.current?.getBoundingClientRect().height ?? Math.round((window.innerHeight - 56) * 0.5);
      setPad({ top: 44, right: 28, bottom: Math.round(sheet) + 16, left: 28 });
    };
    on();
    window.addEventListener("resize", on);
    const ro = panel?.current ? new ResizeObserver(on) : null;
    if (panel?.current) ro?.observe(panel.current);
    return () => {
      window.removeEventListener("resize", on);
      ro?.disconnect();
    };
  }, [panel]);
  return pad;
}

/** How much of the screen the sheet takes on a phone: a bar, half, or nearly all of it. */
export type Snap = "peek" | "half" | "full";
const ORDER: Snap[] = ["peek", "half", "full"];

/**
 * The sheet a trip's panel becomes on a phone. Drag its handle (or tap it) to show more of
 * the plan or more of the globe; `setSnap` lets each action make room for itself (the globe
 * while a city is dragged, the panel while something is typed). Computers ignore it.
 */
export function useSheet(initial: Snap = "half") {
  const [snap, setSnapState] = useState<Snap>(initial);
  const panel = useRef<HTMLElement | null>(null);
  const drag = useRef<{ y0: number; h0: number; t0: number; moved: boolean } | null>(null);
  const setSnap = (s: Snap) => {
    if (typeof window !== "undefined" && window.matchMedia(PHONE).matches) setSnapState(s);
  };
  const heightOf = (s: Snap): number => {
    const stage = panel.current?.parentElement?.clientHeight ?? window.innerHeight;
    if (s === "full") return stage - 10;
    if (s === "half") return stage * 0.52;
    return 150;
  };
  const release = (dy: number, tap: boolean) => {
    const el = panel.current;
    const d = drag.current;
    drag.current = null;
    if (!el || !d) return;
    el.style.height = "";
    el.style.transition = "";
    if (tap) return setSnapState((s) => (s === "full" ? "half" : s === "half" ? "full" : "half"));
    const h = d.h0 - dy;
    const v = dy / Math.max(1, performance.now() - d.t0);
    // A flick goes one step in its direction; a slow drag settles at the nearest height.
    let i = ORDER.reduce((best, s, j) => (Math.abs(heightOf(s) - h) < Math.abs(heightOf(ORDER[best]) - h) ? j : best), 0);
    if (v > 0.6) i = Math.max(0, ORDER.indexOf(snapNow.current) - 1);
    else if (v < -0.6) i = Math.min(2, ORDER.indexOf(snapNow.current) + 1);
    setSnapState(ORDER[i]);
  };
  const snapNow = useRef(snap);
  snapNow.current = snap;
  const grab = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!window.matchMedia(PHONE).matches || !panel.current) return;
      drag.current = { y0: e.clientY, h0: panel.current.getBoundingClientRect().height, t0: performance.now(), moved: false };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      const el = panel.current;
      if (!d || !el) return;
      const dy = e.clientY - d.y0;
      if (!d.moved && Math.abs(dy) < 6) return;
      d.moved = true;
      el.style.transition = "none";
      el.style.height = `${Math.max(heightOf("peek") - 30, Math.min(heightOf("full"), d.h0 - dy))}px`;
    },
    onPointerUp: (e: React.PointerEvent) => {
      const d = drag.current;
      if (d) release(e.clientY - d.y0, !d.moved);
    },
    onPointerCancel: () => release(0, false),
    onKeyDown: (e: React.KeyboardEvent) => {
      const i = ORDER.indexOf(snapNow.current);
      const to = e.key === "ArrowUp" ? i + 1 : e.key === "ArrowDown" ? i - 1 : -1;
      if (to < 0 || to > 2) return;
      e.preventDefault();
      setSnapState(ORDER[to]);
    },
  };
  return { snap, setSnap, panel, grab };
}

/** The sheet's handle: drag it, tap it, or use the arrow keys to show more or less. */
export function SheetGrab({ snap, grab, label }: { snap: Snap; grab: ReturnType<typeof useSheet>["grab"]; label: string }) {
  return (
    <button
      type="button"
      className="sheet-grab"
      aria-label={`${label}: ${snap === "full" ? "shown in full" : snap === "half" ? "half shown" : "folded down"}. Drag, tap, or use the arrow keys to show more or less.`}
      {...grab}
    >
      <span aria-hidden />
    </button>
  );
}

/**
 * The globe behind a trip: the route as a quiet line; its cities and events are icons laid
 * over it (MapIcons), which pop in when they appear.
 */
export function TripGlobe({
  api,
  route,
  fly,
  pad,
  onReady,
  onBackground,
  label,
  quiet,
}: {
  api: RefObject<EarthMapHandle | null>;
  route: FlightRoute | null;
  fly?: FlyRequest;
  pad: Pad;
  onReady?: () => void;
  /** A tap on the globe away from any icon (where, and the place named there, if any). */
  onBackground?: (at: MapClick) => void;
  label: string;
  /** Only the trip on it (no place icons). */
  quiet?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [dark, setDark] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => {
    const root = document.documentElement.dataset.theme;
    setDark(root ? root === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    try {
      const c = document.createElement("canvas");
      setWebgl(!!(c.getContext("webgl2") || c.getContext("webgl")));
    } catch {
      setWebgl(false);
    }
  }, []);
  useEffect(() => {
    if (ready) api.current?.setFlight(route);
  }, [api, route, ready]);
  if (webgl === false) return <div className="trip-globe-fallback" aria-hidden />;
  if (webgl === null) return <div className="trip-globe-loading" aria-hidden />;
  return (
    <EarthMap
      ref={api}
      className="absolute inset-0"
      ariaLabel={label}
      initial={{ lat: 35, lng: 5, zoom: 1.4, pitch: 0, bearing: 0 }}
      projection="globe"
      base={dark ? "lights" : "map"}
      layers={quiet ? QUIET : LAYERS}
      clusters={NONE}
      flyTo={fly}
      framePadding={pad}
      reducedMotion={reduced}
      onMapClick={(c) => onBackground?.(c)}
      onReady={() => {
        setReady(true);
        onReady?.();
      }}
    />
  );
}
const NONE: never[] = [];

/** An icon on the globe: where it is, what it shows, and (to burst out of) where it starts from. */
export interface MapIcon {
  key: string;
  lat: number;
  lng: number;
  node: ReactNode;
  anchor?: "center" | "bottom" | "top";
  /** It springs out from here (a city's pin) to its own place. */
  from?: { lat: number; lng: number };
  /** Milliseconds before it pops in (for a staggered entrance). */
  delay?: number;
  /** Shifted on screen by this many pixels (icons sharing a place fan out round it). */
  offset?: [number, number];
  /** It can be dragged to another place: told where it is as it goes, and where it's dropped. */
  drag?: { onStart?(): void; onMove?(lat: number, lng: number): void; onEnd(lat: number, lng: number): void };
}

/**
 * Icons that would cover each other on screen (several events at one venue, or venues a few
 * streets apart) fanned out in a ring round their middle, like petals, so each can be seen and
 * tapped. `project` gives a place's position on screen now; without it, only icons on the very
 * same spot are fanned.
 */
export function fanOut<T extends { lat: number; lng: number }>(items: T[], project?: (lat: number, lng: number) => { x: number; y: number } | null, gap = 36): (T & { offset?: [number, number] })[] {
  const out: (T & { offset?: [number, number] })[] = items.map((it) => ({ ...it }));
  const at = items.map((it) => project?.(it.lat, it.lng) ?? null);
  const groups: { x: number; y: number; members: number[] }[] = [];
  items.forEach((it, i) => {
    const p = at[i];
    const g = p
      ? groups.find((g) => Math.hypot(g.x - p.x, g.y - p.y) < gap)
      : groups.find((g) => g.members.some((m) => items[m].lat.toFixed(4) === it.lat.toFixed(4) && items[m].lng.toFixed(4) === it.lng.toFixed(4)));
    if (g) g.members.push(i);
    else groups.push({ x: p?.x ?? 0, y: p?.y ?? 0, members: [i] });
  });
  for (const g of groups) {
    if (g.members.length < 2) continue;
    // Rings of 6, 12, 18… round the group's first icon.
    let placed = 0;
    for (let ring = 1; placed < g.members.length; ring++) {
      const n = Math.min(g.members.length - placed, ring * 6);
      for (let j = 0; j < n; j++) {
        const a = (j / n) * Math.PI * 2 - Math.PI / 2 + ring * 0.4;
        const i = g.members[placed + j];
        const p = at[i];
        // From where the icon is to its petal round the group's middle.
        const dx = p ? g.x - p.x : 0;
        const dy = p ? g.y - p.y : 0;
        out[i].offset = [Math.round(dx + Math.cos(a) * gap * ring), Math.round(dy + Math.sin(a) * gap * ring)];
      }
      placed += n;
    }
  }
  return out;
}

/**
 * Icons pinned to the globe: each pops in when it appears (or springs out of `from`), moves
 * with the globe, and shrinks away when it goes.
 */
export function MapIcons({ api, ready, icons }: { api: RefObject<EarthMapHandle | null>; ready: boolean; icons: MapIcon[] }) {
  type Rec = { el: HTMLDivElement; pin: PinHandle; ic: MapIcon; dragging: boolean; dropped: number };
  const pins = useRef(new Map<string, Rec>());
  const [, setTick] = useState(0);
  useEffect(() => {
    const map = api.current;
    if (!ready || !map) return;
    const seen = new Set<string>();
    let added = false;
    for (const ic of icons) {
      seen.add(ic.key);
      const at: [number, number] = [ic.lng, ic.lat];
      const have = pins.current.get(ic.key);
      if (have) {
        have.ic = ic;
        have.pin.setDraggable(!!ic.drag);
        have.el.classList.toggle("is-draggable", !!ic.drag);
        // One being dragged is where the finger is, not where the plan last said.
        if (!have.dragging) have.pin.move(at, ic.offset ?? [0, 0]);
        continue;
      }
      const el = document.createElement("div");
      el.className = "map-icon";
      el.style.setProperty("--delay", `${ic.delay ?? 0}ms`);
      if (ic.from) {
        const a = map.project([ic.from.lng, ic.from.lat]);
        const b = map.project(at);
        if (a && b) {
          const [ox, oy] = ic.offset ?? [0, 0];
          el.style.setProperty("--dx", `${Math.round(a.x - b.x - ox)}px`);
          el.style.setProperty("--dy", `${Math.round(a.y - b.y - oy)}px`);
          el.classList.add("is-burst");
        }
      }
      const rec = { el, ic, dragging: false, dropped: 0 } as Rec;
      const pin = map.pin(el, at, ic.anchor, ic.offset, {
        onStart: () => {
          rec.dragging = true;
          el.classList.add("is-dragging");
          rec.ic.drag?.onStart?.();
        },
        onMove: ([lng, lat]) => rec.ic.drag?.onMove?.(lat, lng),
        onEnd: ([lng, lat]) => {
          rec.dragging = false;
          rec.dropped = Date.now();
          el.classList.remove("is-dragging");
          rec.ic.drag?.onEnd(lat, lng);
        },
      });
      if (!pin) continue;
      rec.pin = pin;
      pin.setDraggable(!!ic.drag);
      el.classList.toggle("is-draggable", !!ic.drag);
      // Letting go after a drag is a drop, not a tap on what was dragged.
      el.addEventListener(
        "click",
        (e) => {
          if (Date.now() - rec.dropped < 400) {
            e.stopPropagation();
            e.preventDefault();
          }
        },
        true,
      );
      pins.current.set(ic.key, rec);
      added = true;
    }
    for (const [k, rec] of pins.current)
      if (!seen.has(k)) {
        rec.el.classList.add("is-leaving");
        window.setTimeout(() => rec.pin.remove(), 220);
        pins.current.delete(k);
      }
    if (added) setTick((n) => n + 1);
  }, [api, ready, icons]);
  useEffect(() => {
    const all = pins.current;
    return () => {
      for (const rec of all.values()) rec.pin.remove();
      all.clear();
    };
  }, []);
  return (
    <>
      {icons.map((ic) => {
        const rec = pins.current.get(ic.key);
        return rec ? createPortal(ic.node, rec.el, ic.key) : null;
      })}
    </>
  );
}

/** A box round places, for framing them ([west, south, east, north]). */
export function bboxOf(points: { lat: number; lng: number }[], min = 0.3): [number, number, number, number] | undefined {
  if (!points.length) return undefined;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const pad = points.length === 1 ? 0.6 : 0.15;
  const w = Math.min(...lngs), e = Math.max(...lngs), s = Math.min(...lats), n = Math.max(...lats);
  const dx = Math.max(min, (e - w) * pad), dy = Math.max(min, (n - s) * pad);
  return [w - dx, s - dy, e + dx, n + dy];
}

/** The route as a line between the cities, in order (the cities themselves are icons). */
export function routeOf(stops: Pick<TripStop, "lat" | "lng">[]): FlightRoute | null {
  if (stops.length < 2) return null;
  return { stops: stops.map((s) => [s.lng, s.lat]), reached: stops.length, lineOnly: true };
}

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });

/** "1–4 Jun", "30 Jun – 2 Jul". */
export function shortRange(from: string, to: string): string {
  if (from.slice(0, 7) === to.slice(0, 7)) return `${fmt(from, { day: "numeric" })}–${fmt(to, { day: "numeric", month: "short" })}`;
  return `${fmt(from, { day: "numeric", month: "short" })} – ${fmt(to, { day: "numeric", month: "short" })}`;
}

/** "Tue 1 Jun". */
export const dayLabel = (d: string) => fmt(d, { weekday: "short", day: "numeric", month: "short" });

/** "1 – 8 June 2027". */
export function longRange(from?: string, to?: string): string {
  if (!from || !to) return "Dates to choose";
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${fmt(from, { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) })} – ${fmt(to, { day: "numeric", month: "long", year: "numeric" })}`;
}

export { tripSnapOf, type TripEvent } from "@/lib/trip-snap";

/**
 * A trip's events: the copies kept with the trip, refreshed from the catalogue while the
 * events are listed; trips made before copies were kept load theirs from the catalogue.
 */
export function useTripEvents(trip: Trip | undefined): { events: TripEvent[]; loading: boolean } {
  const ids = trip?.eventIds.join(",") ?? "";
  const [listed, setListed] = useState<Map<string, EventCard> | null>(null);
  useEffect(() => {
    if (!ids) return setListed(new Map());
    const ctrl = new AbortController();
    fetch(`/api/events/batch?ids=${encodeURIComponent(ids)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((j: { items: EventCard[] }) => setListed(new Map(j.items.map((c) => [c.id, c]))))
      .catch(() => setListed(new Map()));
    return () => ctrl.abort();
  }, [ids]);
  const events = useMemo(() => {
    if (!trip) return [];
    return trip.eventIds
      .map((id): TripEvent | undefined => {
        const c = listed?.get(id);
        if (c) return tripSnapOf(c);
        const s = trip.snaps?.[id];
        return s ? { id, ...s } : undefined;
      })
      .filter((e): e is TripEvent => !!e)
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [trip, listed]);
  return { events, loading: listed === null };
}

/** An event card shape for a kept copy (to draw it with the usual parts). */
export function cardOf(e: TripEvent): EventCard {
  return { id: e.id, slug: e.slug, title: e.title, start: e.start, timeZone: e.timeZone, eventType: e.eventType, hoursUnknown: e.hoursUnknown, venueName: e.venueName, venueSlug: e.venueSlug ?? "", imageUrl: e.imageUrl, posterHue: e.posterHue, categorySlug: e.categorySlug, groupSlug: e.groupSlug, lat: e.lat, lng: e.lng, city: e.city } as unknown as EventCard;
}

/**
 * A trip as a boarding pass: its name, its route in three-letter codes, its dates; the stub
 * with the nights, cities and events.
 */
export function TripPass({ name, emoji, stops, start, end, events, compact = false }: { name: string; emoji?: string; stops: Pick<TripStop, "name" | "countryCode">[]; start?: string; end?: string; events: number; compact?: boolean }) {
  const flags = [...new Set(stops.map((s) => flagOf(s.countryCode)).filter(Boolean))];
  const nights = start && end ? nightsBetween(start, end) : 0;
  return (
    <div className={`trip-pass ticket-wrap ${compact ? "is-compact" : ""}`} style={{ "--ink": stopColor(0) } as React.CSSProperties}>
      <div className="ticket">
        <div className="trip-pass-main">
          <p className="trip-pass-name">
            <span aria-hidden>{emoji ?? "✈️"}</span> {name}
          </p>
          {stops.length > 0 && (
            <p className="trip-pass-route" aria-label={`Route: ${stops.map((s) => s.name).join(", then ")}`}>
              {stops.slice(0, 6).map((s, i) => (
                <span key={`${s.name}-${i}`} className="trip-pass-code">
                  {i > 0 && <span className="trip-pass-arrow" aria-hidden>→</span>}
                  <b>{codeOf(s.name)}</b>
                </span>
              ))}
              {stops.length > 6 && <span className="text-text-3">+{stops.length - 6}</span>}
            </p>
          )}
          <p className="t-small text-text-2 mt-1">
            {longRange(start, end)} {flags.length > 0 && <span aria-hidden className="ml-1">{flags.join(" ")}</span>}
          </p>
        </div>
        <div className="ticket-stub trip-pass-stub">
          <p className="ticket-date">
            <span className="ticket-day tnum">{nights || "–"}</span>
            <span className="ticket-month">{nights === 1 ? "night" : "nights"}</span>
          </p>
          <p className="t-small text-text-2">
            {stops.length} {stops.length === 1 ? "city" : "cities"}, {events} {events === 1 ? "event" : "events"}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * A city on the trip's globe: a numbered pin in the stop's colour with its name, and a small
 * note (its nights) and the emojis of what's wanted there. Tapping it picks the city.
 */
export function CityPin({ n, name, color, active, note, emojis, small, looking, hint, onClick }: { n: number; name: string; color: string; active?: boolean; note?: string; emojis?: string[]; /** Just the number (its events are out round it). */ small?: boolean; /** Finding out where it's been dropped. */ looking?: boolean; /** Said to screen readers after the name ("drag to move it"). */ hint?: string; onClick?: () => void }) {
  return (
    <button type="button" className="city-pin" data-active={active || undefined} data-small={small || undefined} data-looking={looking || undefined} style={{ "--ink": color } as React.CSSProperties} onClick={(e) => (e.stopPropagation(), onClick?.())} aria-label={`${n}: ${looking ? "finding the place" : name}${note ? `, ${note.replace(/n$/, " nights")}` : ""}${hint ? `. ${hint}` : ""}`} aria-pressed={active}>
      <span className="city-pin-tag">
        <span className="city-pin-n">{n}</span>
        <span className="city-pin-name">{looking ? "Finding…" : name}</span>
        {note && <span className="city-pin-note tnum">{note}</span>}
      </span>
      {emojis && emojis.length > 0 && (
        <span className="city-pin-emojis" aria-hidden>
          {emojis.map((e, i) => (
            <span key={e} style={{ "--i": i } as React.CSSProperties}>{e}</span>
          ))}
        </span>
      )}
      <span className="city-pin-dot" aria-hidden />
    </button>
  );
}
