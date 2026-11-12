"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { BedDouble, ChevronLeft, ChevronRight, ListOrdered, MapPin, Pause, Play, RotateCcw, SkipBack, SkipForward, Sparkles, X } from "lucide-react";
import type { Trip } from "@/lib/user/store";
import { flagOf, nightsBetween, stopColor, type TripStop } from "@/lib/trip";
import { haversineKm } from "@/lib/geo";
import { kindLabel } from "@/lib/trip-plans";
import { poiLabel } from "@/lib/pois";
import { buildShow, legMs, type Scene, type ShowItem } from "@/lib/trip-show";
import type { TripEvent } from "@/lib/trip-snap";
import type { EarthMapHandle } from "../earth/earth-map";
import { Poster } from "../ui";
import { KIND_ICON } from "./plan-icons";

/*
 * View trip: the trip as a film on the globe. It flies in, lands in each city, walks through
 * its days place by place (the camera tilting in on each one while its card says when, what
 * and why), crosses to the next city and comes home, then shows the trip in numbers. It plays
 * by itself; tap the right of the screen (or →) for the next part, the left (or ←) to go back,
 * hold to pause, change the speed, or jump to any city or day.
 */

const SPEEDS = [0.5, 1, 1.5, 2] as const;
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const dayName = (d: string) => fmt(d, { weekday: "long", day: "numeric", month: "long" });
const short = (d: string) => fmt(d, { weekday: "short", day: "numeric", month: "short" });
const codeOf = (s: string) => s.normalize("NFD").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "···";
const nf = new Intl.NumberFormat("en-GB");

function longRange(a?: string, b?: string) {
  if (!a || !b) return "";
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  return sameMonth ? `${fmt(a, { day: "numeric" })} – ${fmt(b, { day: "numeric", month: "long", year: "numeric" })}` : `${fmt(a, { day: "numeric", month: "long" })} – ${fmt(b, { day: "numeric", month: "long", year: "numeric" })}`;
}

/** A zoom that shows points this far apart. */
function zoomFor(km: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, 14.4 - Math.log2(Math.max(km, 0.4) / 1.2)));
}
function spread(points: [number, number][]) {
  let far = 0;
  for (const a of points) for (const b of points) far = Math.max(far, haversineKm(a[1], a[0], b[1], b[0]));
  return far;
}
const centre = (points: [number, number][]): [number, number] => [points.reduce((n, p) => n + p[0], 0) / points.length, points.reduce((n, p) => n + p[1], 0) / points.length];
const routeZoom = (km: number) => (km > 4000 ? 1.5 : km > 1500 ? 2.6 : km > 600 ? 3.8 : km > 200 ? 5.2 : km > 60 ? 7 : 9);

function ItemIcon({ kind, size = 15 }: { kind: ShowItem["kind"]; size?: number }) {
  if (kind === "event") return <Sparkles size={size} aria-hidden />;
  const I = KIND_ICON[kind];
  return <I size={size} aria-hidden />;
}

export function TripShow({ trip, stops, events, api, pad, startAt, onClose, onOpenEvent }: { trip: Trip; stops: TripStop[]; events: { e: TripEvent; day: string }[]; api: RefObject<EarthMapHandle | null>; /** The room the cards and controls take on screen. */ pad: { top: number; right: number; bottom: number; left: number }; /** A chapter to start at (a city's id). */ startAt?: string; onClose: () => void; onOpenEvent?: (id: string) => void }) {
  const show = useMemo(() => buildShow({ trip, stops, events }), [trip, stops, events]);
  const { scenes, chapters, stats } = show;
  const first = Math.max(0, startAt ? (chapters.find((c) => c.key === `stop-${startAt}`)?.first ?? 0) : 0);
  const [at, setAt] = useState(first);
  const [epoch, setEpoch] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [list, setList] = useState(false);
  const [bar, setBar] = useState({ total: 1, done: 0, running: false, n: 0 });
  const box = useRef<HTMLDivElement>(null);
  const playBtn = useRef<HTMLButtonElement>(null);
  const timer = useRef(0);
  const clock = useRef({ left: 0, since: 0, total: 0 });
  const landed = useRef(true);
  const spot = useRef<{ remove(): void } | null>(null);
  const live = useRef({ at, playing, speed, scenes });
  live.current = { at, playing, speed, scenes };
  const sc: Scene | undefined = scenes[Math.min(at, scenes.length - 1)];
  const points = useMemo(() => stops.map((s) => [s.lng, s.lat] as [number, number]), [stops]);

  // ---- the camera, for each kind of scene
  const camera = useCallback(
    (s: Scene, resume = false) => {
      const m = api.current;
      if (!m) return;
      const k = live.current.speed;
      spot.current?.remove();
      spot.current = null;
      landed.current = false;
      const done = (ok: boolean) => {
        landed.current = ok;
      };
      const routeView = () => {
        if (points.length) m.viewRoute(points, routeZoom(spread(points)));
        landed.current = true;
      };
      switch (s.type) {
        case "intro":
        case "outro":
          return routeView();
        case "leg": {
          if (!s.to) return routeView();
          const ms = Math.max(1400, (s.from && !resume ? legMs(s.km ?? 0) : 2600) / k);
          void m.flyLeg(s.from && !resume ? [s.from.lng, s.from.lat] : null, [s.to.lng, s.to.lat], { zoom: 11.4, pitch: 48, orbitMs: 12000, ms }).then(done);
          return;
        }
        case "city":
          void m.glideTo([s.stop.lng, s.stop.lat], { zoom: 12.4, pitch: 42, ms: 2200 / k, orbitMs: 14000 }).then(done);
          return;
        case "day": {
          const pts = s.items.filter((x) => x.lat != null && x.lng != null).map((x) => [x.lng!, x.lat!] as [number, number]);
          const all: [number, number][] = pts.length ? pts : [[s.stop.lng, s.stop.lat]];
          void m.glideTo(centre(all), { zoom: pts.length > 1 ? zoomFor(spread(all), 11.5, 14) : 13, pitch: 38, ms: 1900 / k, orbitMs: 12000 }).then(done);
          return;
        }
        case "item": {
          const x = s.item;
          if (x.lat == null || x.lng == null) return done(true);
          void m.glideTo([x.lng, x.lat], { zoom: 16.3, pitch: 60, bearing: -40 + ((s.n * 53) % 90), ms: 2300 / k, orbitMs: 16000 }).then(done);
          // A ring on the place, where it is on the globe.
          const el = document.createElement("span");
          el.className = "show-spot";
          el.setAttribute("aria-hidden", "true");
          el.dataset.kind = x.kind === "event" ? "activity" : x.kind;
          spot.current = m.pin(el, [x.lng, x.lat], "center");
          return;
        }
        case "wish": {
          const pts = s.places.map((p) => [p.lng!, p.lat!] as [number, number]);
          void m.glideTo(centre(pts), { zoom: zoomFor(spread(pts), 11, 15), pitch: 30, ms: 2000 / k, orbitMs: 12000 }).then(done);
          return;
        }
      }
    },
    [api, points],
  );

  // ---- time: each scene runs its time (at the speed chosen), then the next one starts
  const arm = useCallback((left: number, total: number, running: boolean) => {
    window.clearTimeout(timer.current);
    clock.current = { left, since: performance.now(), total };
    setBar((b) => ({ total, done: total - left, running: running && total > 0, n: b.n + 1 }));
    if (running && total > 0) timer.current = window.setTimeout(() => setAt((i) => Math.min(i + 1, live.current.scenes.length - 1)), left);
  }, []);
  const freeze = useCallback(() => {
    window.clearTimeout(timer.current);
    const c = clock.current;
    c.left = Math.max(0, c.left - (performance.now() - c.since));
    c.since = performance.now();
    setBar((b) => ({ total: c.total, done: c.total - c.left, running: false, n: b.n + 1 }));
  }, []);

  // A new scene: the camera goes, the clock starts.
  useEffect(() => {
    const s = live.current.scenes[at];
    if (!s) return;
    camera(s);
    const total = s.ms ? s.ms / live.current.speed : 0;
    // The clock starts once the scene is on screen.
    const raf = requestAnimationFrame(() => arm(total, total, live.current.playing));
    // The pictures of what's next, ready before it's on screen.
    for (const n of live.current.scenes.slice(at + 1, at + 3)) {
      if (n.type === "item" && n.item.image) new Image().src = n.item.image;
    }
    return () => cancelAnimationFrame(raf);
  }, [at, epoch, camera, arm]);

  // Pause and play: the clock and the camera hold, and pick up where they were.
  const setPlay = useCallback(
    (on: boolean) => {
      if (on === live.current.playing) return;
      setPlaying(on);
      live.current.playing = on;
      const s = live.current.scenes[live.current.at];
      if (!on) {
        freeze();
        api.current?.halt();
        return;
      }
      if (s && !landed.current) camera(s, true);
      arm(clock.current.left, clock.current.total, true);
    },
    [api, arm, camera, freeze],
  );
  const go = useCallback((i: number) => {
    const n = live.current.scenes.length;
    setAt(Math.max(0, Math.min(n - 1, i)));
    setEpoch((e) => e + 1);
  }, []);
  const next = useCallback(() => go(live.current.at + 1), [go]);
  const replay = () => {
    setPlaying(true);
    live.current.playing = true;
    go(0);
  };
  const prev = useCallback(() => go(live.current.at - 1), [go]);
  const changeSpeed = () => {
    const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    const was = live.current.speed;
    setSpeed(nextSpeed);
    live.current.speed = nextSpeed;
    if (live.current.playing) freeze();
    const c = clock.current;
    arm((c.left * was) / nextSpeed, (c.total * was) / nextSpeed, live.current.playing);
  };

  // Keys: space, arrows, escape; a hidden tab holds the show.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea, select")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (list) setList(false);
        else onClose();
      } else if (e.key === " " || e.key === "k") {
        if ((e.target as HTMLElement).closest?.("button, a") && e.key === " ") return;
        e.preventDefault();
        setPlay(!live.current.playing);
      } else if (e.key === "ArrowRight" || e.key === "l") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft" || e.key === "j") {
        e.preventDefault();
        prev();
      }
    };
    const onHide = () => document.hidden && setPlay(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [list, next, prev, onClose, setPlay]);

  // Opening: the keyboard on the play button; closing: the camera stops, the ring goes.
  useEffect(() => {
    playBtn.current?.focus({ preventScroll: true });
    api.current?.padTo(pad);
    const m = api.current;
    return () => {
      window.clearTimeout(timer.current);
      spot.current?.remove();
      m?.halt();
    };
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // The chapter list holds the show while it's open.
  const wasPlaying = useRef(false);
  const openList = (open: boolean) => {
    if (open) {
      wasPlaying.current = live.current.playing;
      setPlay(false);
    } else if (wasPlaying.current) setPlay(true);
    setList(open);
  };

  // Tap the screen: right for the next part, left to go back; hold anywhere to pause.
  const hold = useRef<{ t: number; was: boolean; timer: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const was = live.current.playing;
    hold.current = { t: performance.now(), was, timer: window.setTimeout(() => was && setPlay(false), 240) };
  };
  const onUp = (e: React.PointerEvent) => {
    const h = hold.current;
    hold.current = null;
    if (!h) return;
    window.clearTimeout(h.timer);
    if (performance.now() - h.t < 240) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      if (e.clientX - r.left < r.width * 0.3) prev();
      else next();
    } else if (h.was) setPlay(true);
  };

  // A simple keyboard trap: Tab stays in the show.
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !box.current) return;
    const f = [...box.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) {
      e.preventDefault();
      f[f.length - 1].focus();
    } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
      e.preventDefault();
      f[0].focus();
    }
  };

  if (!sc) return null;
  const ch = sc.chapter;
  const ink = "index" in sc ? stopColor(sc.index) : "var(--cyan)";
  const said = sayOf(sc, trip);

  return createPortal(
    <div ref={box} className="show" role="dialog" aria-modal="true" aria-label={`${trip.name}: the trip, played`} data-type={sc.type} data-paused={!playing || undefined} style={{ "--ink": ink } as React.CSSProperties} onKeyDown={trap}>
      <div className="show-shade" aria-hidden />
      <div className="show-tap" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (hold.current = null)} aria-hidden>
        <span className="show-tap-hint show-tap-prev"><ChevronLeft size={22} /></span>
        <span className="show-tap-hint show-tap-next"><ChevronRight size={22} /></span>
      </div>

      <div className="show-top">
        <div className="show-bars" role="group" aria-label="Parts of the trip">
          {chapters.map((c, i) => {
            const inside = i === ch;
            const k = inside ? at - c.first : 0;
            const from = inside ? (k / c.count) * 100 : i < ch ? 100 : 0;
            const to = inside ? ((k + 1) / c.count) * 100 : from;
            const frac = bar.total ? bar.done / bar.total : 1;
            return (
              <button key={c.key} type="button" className="show-bar" style={{ flexGrow: Math.max(1, c.count) } as React.CSSProperties} aria-label={`${c.label}${c.sub ? `, ${c.sub}` : ""}${inside ? " (now)" : ""}`} aria-current={inside || undefined} onClick={() => go(c.first)}>
                <span
                  key={inside ? `${at}-${epoch}-${bar.n}` : "x"}
                  className="show-bar-fill"
                  data-running={(inside && bar.running && playing) || undefined}
                  style={
                    {
                      "--from": `${from + (to - from) * (inside ? frac : 0)}%`,
                      "--to": `${to}%`,
                      "--dur": `${Math.max(1, bar.total - bar.done)}ms`,
                      "--c": c.index != null ? stopColor(c.index) : "#fff",
                    } as React.CSSProperties
                  }
                />
              </button>
            );
          })}
        </div>
        <div className="show-topline">
          <p className="show-trip"><span aria-hidden>{trip.emoji ?? "✈️"}</span> {trip.name}</p>
          <p className="show-where">{chapters[ch]?.label}{chapters[ch]?.sub ? <span> · {chapters[ch].sub}</span> : null}</p>
          <button type="button" className="show-icon" aria-label="Close the show" onClick={onClose}><X size={18} aria-hidden /></button>
        </div>
      </div>

      <div className="show-stage">
        <SceneCard key={`${sc.key}-${epoch}`} sc={sc} trip={trip} stops={stops} stats={stats} dur={sc.ms / speed} onReplay={replay} onClose={onClose} onOpenEvent={onOpenEvent} />
      </div>

      <div className="show-controls" role="toolbar" aria-label="Show controls">
        <button type="button" className="show-icon" aria-label="Previous part" disabled={at === 0} onClick={prev}><SkipBack size={18} aria-hidden /></button>
        <button ref={playBtn} type="button" className="show-play" aria-label={sc.type === "outro" ? "Play again" : playing ? "Pause" : "Play"} onClick={() => (sc.type === "outro" ? replay() : setPlay(!playing))}>
          {sc.type === "outro" ? <RotateCcw size={20} aria-hidden /> : playing ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
        </button>
        <button type="button" className="show-icon" aria-label="Next part" disabled={at >= scenes.length - 1} onClick={next}><SkipForward size={18} aria-hidden /></button>
        <span className="show-sep" aria-hidden />
        <button type="button" className="show-speed" aria-label={`Speed ${speed} times. Change`} onClick={changeSpeed}>{speed}×</button>
        <button type="button" className="show-icon" aria-label="All the parts" aria-expanded={list} onClick={() => openList(!list)}><ListOrdered size={18} aria-hidden /></button>
        <span className="show-count tnum max-sm:hidden" aria-hidden>{at + 1}/{scenes.length}</span>
      </div>

      {list && (
        <div className="show-list" role="dialog" aria-label="Go to a part of the trip">
          <div className="flex items-center justify-between">
            <p className="show-list-h">Go to</p>
            <button type="button" className="show-icon" aria-label="Close the list" onClick={() => openList(false)}><X size={16} aria-hidden /></button>
          </div>
          <ol>
            {chapters.map((c, i) => (
              <li key={c.key}>
                <button type="button" className="show-list-ch" aria-current={i === ch || undefined} style={{ "--c": c.index != null ? stopColor(c.index) : "#fff" } as React.CSSProperties} onClick={() => (go(c.first), openList(false))}>
                  {c.index != null ? <span className="show-n">{c.index + 1}</span> : <span className="show-n show-n-plain" aria-hidden>{i === 0 ? "▸" : "■"}</span>}
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.sub && <span className="show-list-sub">{c.sub}</span>}
                </button>
                {c.index != null && (
                  <ul className="show-list-days">
                    {scenes.slice(c.first, c.first + c.count).map((s, j) =>
                      s.type === "day" ? (
                        <li key={s.key}>
                          <button type="button" aria-current={c.first + j === at || undefined} onClick={() => (go(c.first + j), openList(false))}>
                            Day {s.n} · {short(s.day)} <span>{s.items.length ? `${s.items.length} planned` : "free"}</span>
                          </button>
                        </li>
                      ) : null,
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="sr-only" aria-live="polite">{said}</p>
      <p className="show-hint max-lg:hidden" aria-hidden>Space to pause · ← → to skip · click the left or right of the screen</p>
    </div>,
    document.body,
  );
}

/** What's on screen, in words (for screen readers). */
function sayOf(sc: Scene, trip: Trip): string {
  switch (sc.type) {
    case "intro":
      return `${trip.name}.`;
    case "leg":
      return `${sc.plan ? kindLabel(sc.plan.kind) : "On the way"}${sc.from ? ` from ${sc.from.name}` : ""}${sc.to ? ` to ${sc.to.name}` : " home"}.`;
    case "city":
      return `${sc.stop.name}, ${nightsBetween(sc.stop.from, sc.stop.to)} nights.`;
    case "day":
      return `Day ${sc.n}, ${dayName(sc.day)}: ${sc.items.length ? `${sc.items.length} planned` : "a free day"}.`;
    case "item":
      return `${sc.item.time ? `${sc.item.time}, ` : ""}${sc.item.title}.`;
    case "wish":
      return `Still to see in ${sc.stop.name}: ${sc.places.map((p) => p.title).join(", ")}.`;
    case "outro":
      return "That's the trip.";
  }
}

function SceneCard({
  sc,
  trip,
  stops,
  stats,
  dur,
  onReplay,
  onClose,
  onOpenEvent,
}: {
  sc: Scene;
  trip: Trip;
  stops: TripStop[];
  stats: ReturnType<typeof buildShow>["stats"];
  dur: number;
  onReplay: () => void;
  onClose: () => void;
  onOpenEvent?: (id: string) => void;
}) {
  const style = { "--dur": `${Math.max(1200, dur || 6000)}ms` } as React.CSSProperties;
  switch (sc.type) {
    case "intro":
      return (
        <article className="show-card show-intro" style={style}>
          <p className="show-kicker s-in" style={{ "--i": 0 } as React.CSSProperties}>Your trip</p>
          <h2 className="show-title s-in" style={{ "--i": 1 } as React.CSSProperties}><span aria-hidden>{trip.emoji ?? "✈️"}</span> {trip.name}</h2>
          <p className="show-sub s-in" style={{ "--i": 2 } as React.CSSProperties}>{longRange(trip.start ?? stops[0]?.from, trip.end ?? stops[stops.length - 1]?.to)}</p>
          {stops.length > 0 && (
            <ol className="show-route s-in" style={{ "--i": 3 } as React.CSSProperties} aria-label="The route">
              {stops.map((s, i) => (
                <li key={s.id} style={{ "--c": stopColor(i) } as React.CSSProperties}>
                  <span className="show-n">{i + 1}</span> {s.name}
                </li>
              ))}
            </ol>
          )}
          <p className="show-facts s-in" style={{ "--i": 4 } as React.CSSProperties}>
            {[stats.nights ? `${stats.nights} ${stats.nights === 1 ? "night" : "nights"}` : "", `${stats.cities} ${stats.cities === 1 ? "city" : "cities"}`, stats.km ? `${nf.format(stats.km)} km` : "", stats.planned + stats.events ? `${stats.planned + stats.events} things planned` : ""].filter(Boolean).join(" · ")}
          </p>
        </article>
      );
    case "leg": {
      const fromName = sc.from?.name ?? sc.plan?.from ?? "Home";
      const toName = sc.to?.name ?? sc.plan?.to ?? "Home";
      const Icon = sc.plan ? KIND_ICON[sc.plan.kind] : KIND_ICON.car;
      return (
        <article className="show-card show-leg" style={style}>
          <p className="show-kicker s-in" style={{ "--i": 0 } as React.CSSProperties}>
            {sc.plan ? kindLabel(sc.plan.kind) : "On the way"}
            {sc.plan?.ref ? ` · ${sc.plan.ref}` : ""}
            {sc.plan?.day ? ` · ${short(sc.plan.day)}` : ""}
          </p>
          <div className="show-pass s-in" style={{ "--i": 1 } as React.CSSProperties}>
            <div>
              <b>{codeOf(fromName)}</b>
              <span>{fromName}</span>
              {sc.plan?.time && <em className="tnum">{sc.plan.time}</em>}
            </div>
            <span className="show-pass-line" aria-hidden>
              <span className="show-pass-mover"><Icon size={18} /></span>
            </span>
            <div className="text-right">
              <b>{codeOf(toName)}</b>
              <span>{toName}</span>
              {sc.plan?.endTime && <em className="tnum">{sc.plan.endTime}</em>}
            </div>
          </div>
          <p className="show-sub s-in" style={{ "--i": 2 } as React.CSSProperties}>
            {sc.km ? `${nf.format(sc.km)} km` : sc.to ? "Into the trip" : "Home again"}
            {!sc.plan && sc.from && sc.to ? " · how you go isn't planned yet" : ""}
          </p>
        </article>
      );
    }
    case "city": {
      const n = nightsBetween(sc.stop.from, sc.stop.to);
      return (
        <article className="show-card show-city" style={style}>
          <p className="show-kicker s-in" style={{ "--i": 0 } as React.CSSProperties}>
            <span className="show-n" style={{ "--c": stopColor(sc.index) } as React.CSSProperties}>{sc.index + 1}</span> City {sc.index + 1} of {stops.length}
          </p>
          <h2 className="show-title s-in" style={{ "--i": 1 } as React.CSSProperties}>{sc.stop.name} <span aria-hidden>{flagOf(sc.stop.countryCode)}</span></h2>
          <p className="show-sub s-in" style={{ "--i": 2 } as React.CSSProperties}>{short(sc.stop.from)} → {short(sc.stop.to)} · {n} {n === 1 ? "night" : "nights"}</p>
          <p className="show-line s-in" style={{ "--i": 3 } as React.CSSProperties}>
            <BedDouble size={15} aria-hidden /> {sc.stay ? <>Sleeping at <b>{sc.stay.title}</b></> : "No bed booked yet"}
          </p>
          <p className="show-line s-in" style={{ "--i": 4 } as React.CSSProperties}>
            <MapPin size={15} aria-hidden /> {sc.planned ? `${sc.planned} ${sc.planned === 1 ? "thing" : "things"} planned here` : "Nothing planned yet: room to wander"}
          </p>
        </article>
      );
    }
    case "day":
      return (
        <article className="show-card show-day" style={style}>
          <p className="show-kicker s-in" style={{ "--i": 0 } as React.CSSProperties}>Day {sc.n} · {sc.stop.name}</p>
          <h2 className="show-title s-in" style={{ "--i": 1 } as React.CSSProperties}>{dayName(sc.day)}</h2>
          {sc.items.length ? (
            <ol className="show-daylist">
              {sc.items.slice(0, 6).map((x, i) => (
                <li key={x.key} className="s-in" style={{ "--i": 2 + i } as React.CSSProperties} data-kind={x.kind === "event" ? "activity" : x.kind}>
                  <span className="tnum show-daylist-t">{x.time ?? "Any time"}</span>
                  <span className="show-daylist-i"><ItemIcon kind={x.kind} size={13} /></span>
                  <span className="truncate">{x.title}</span>
                </li>
              ))}
              {sc.items.length > 6 && <li className="s-in show-more" style={{ "--i": 8 } as React.CSSProperties}>and {sc.items.length - 6} more</li>}
            </ol>
          ) : (
            <p className="show-sub s-in" style={{ "--i": 2 } as React.CSSProperties}>A free day in {sc.stop.name}. Wander.</p>
          )}
        </article>
      );
    case "item": {
      const x = sc.item;
      const what = x.kind === "event" ? "Event" : kindLabel(x.kind);
      const where = x.place ?? (x.poi ? poiLabel(...(x.poi.split("/") as [string, string?])) : undefined);
      return (
        <article className="show-card show-item" style={style} data-kind={x.kind === "event" ? "activity" : x.kind}>
          {(x.image || x.event) && (
            <div className="show-pic">
              {x.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={x.image} alt="" />
              ) : x.event ? (
                <Poster title={x.event.title} imageUrl={x.event.imageUrl} hue={x.event.posterHue} categorySlug={x.event.categorySlug} size="md" className="h-full w-full" />
              ) : null}
            </div>
          )}
          <div className="show-item-body">
            <p className="show-kicker s-in" style={{ "--i": 0 } as React.CSSProperties}>
              <span className="show-kind"><ItemIcon kind={x.kind} size={13} /></span> {what} · {short(sc.day)} · {sc.n} of {sc.of}
            </p>
            <p className="show-time tnum s-in" style={{ "--i": 1 } as React.CSSProperties}>{x.time ?? "Any time"}{x.endTime ? <span>–{x.endTime}</span> : null}</p>
            <h2 className="show-title show-title-sm s-in" style={{ "--i": 2 } as React.CSSProperties}>{x.title}</h2>
            {where && <p className="show-sub s-in" style={{ "--i": 3 } as React.CSSProperties}>{where}</p>}
            {x.notes && <p className="show-note s-in" style={{ "--i": 4 } as React.CSSProperties}>“{x.notes}”</p>}
            {x.event && onOpenEvent && (
              <Link href={`/events/${x.event.slug}`} className="show-link s-in" style={{ "--i": 5 } as React.CSSProperties} onClick={() => onClose()}>
                See the event →
              </Link>
            )}
          </div>
        </article>
      );
    }
    case "wish":
      return (
        <article className="show-card show-wish" style={style}>
          <p className="show-kicker s-in" style={{ "--i": 0 } as React.CSSProperties}>Still on your list</p>
          <h2 className="show-title show-title-sm s-in" style={{ "--i": 1 } as React.CSSProperties}>Places to see in {sc.stop.name}</h2>
          <ul className="show-chips">
            {sc.places.slice(0, 8).map((p, i) => (
              <li key={p.id} className="s-in" style={{ "--i": 2 + i } as React.CSSProperties} data-kind={p.kind}>
                <ItemIcon kind={p.kind} size={12} /> {p.title}
              </li>
            ))}
          </ul>
          <p className="show-sub s-in" style={{ "--i": 10 } as React.CSSProperties}>No day for them yet: pick one in {sc.stop.name}&apos;s page.</p>
        </article>
      );
    case "outro":
      return (
        <article className="show-card show-outro" style={style}>
          <p className="show-kicker s-in" style={{ "--i": 0 } as React.CSSProperties}>That&apos;s the trip</p>
          <h2 className="show-title s-in" style={{ "--i": 1 } as React.CSSProperties}><span aria-hidden>{trip.emoji ?? "✈️"}</span> {trip.name}</h2>
          <dl className="show-numbers">
            {[
              [stats.nights, stats.nights === 1 ? "night" : "nights"],
              [stats.cities, stats.cities === 1 ? "city" : "cities"],
              [stats.km, "km"],
              [stats.planned, stats.planned === 1 ? "plan" : "plans"],
              [stats.events, stats.events === 1 ? "event" : "events"],
              [stats.toSee, "to see"],
            ]
              .filter(([n], i) => i < 2 || Number(n) > 0)
              .map(([n, label], i) => (
                <div key={String(label)} className="s-in" style={{ "--i": 2 + i } as React.CSSProperties}>
                  <dt className="tnum">{nf.format(Number(n))}</dt>
                  <dd>{label}</dd>
                </div>
              ))}
          </dl>
          <div className="show-actions s-in" style={{ "--i": 9 } as React.CSSProperties}>
            <button type="button" className="btn btn-primary btn-sm press" onClick={onReplay}><RotateCcw size={14} aria-hidden /> Play again</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Back to the trip</button>
          </div>
        </article>
      );
  }
}
