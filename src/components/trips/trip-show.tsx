"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { BedDouble, Check, ChevronLeft, ChevronRight, Flag, ListOrdered, MapPin, Pause, Pencil, Play, Plus, RotateCcw, Share2, SkipBack, SkipForward, Sparkles, Trash2, X } from "lucide-react";
import { userActions, type Trip } from "@/lib/user/store";
import { daysOf, flagOf, nightsBetween, stopColor, type TripStop } from "@/lib/trip";
import { haversineKm } from "@/lib/geo";
import { kindLabel, type PlanKind, type TripPlan } from "@/lib/trip-plans";
import { poiLabel } from "@/lib/pois";
import { buildShow, legMs, type Scene, type ShowItem } from "@/lib/trip-show";
import type { TripEvent } from "@/lib/trip-snap";
import type { EarthMapHandle } from "../earth/earth-map";
import { Poster } from "../ui";
import { toast } from "../toast";
import { KIND_ICON } from "./plan-icons";
import { WhenPicker } from "./when-picker";
import { QuickAdd } from "./city-plan";

/*
 * View trip: the trip as stories on the globe. It flies in, lands in each city, walks through
 * its days place by place (the camera tilting in on each one, the day's way dotted on the map,
 * while its card says when, what and why), crosses to the next city and comes home, then shows
 * the trip in numbers. It plays by itself.
 *
 * Like stories: tap the right for the next part and the left to go back, swipe sideways for the
 * next or last city, hold to pause and see the map alone, swipe down to close. Or the arrows
 * (Shift for a city), Space, a city's number. Skipping fast makes the camera fast too. Anything
 * can be changed as it plays: a time, a note, a day, what's added to a day, how you get from
 * city to city, where you sleep.
 */

const SPEEDS = [0.5, 1, 1.5, 2] as const;
type Speed = (typeof SPEEDS)[number];
const SPEED_KEY = "omnievent:show-speed";
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const dayName = (d: string) => fmt(d, { weekday: "long", day: "numeric", month: "long" });
const short = (d: string) => fmt(d, { weekday: "short", day: "numeric", month: "short" });
const codeOf = (s: string) => s.normalize("NFD").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "···";
const nf = new Intl.NumberFormat("en-GB");
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 12) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`);

function longRange(a?: string, b?: string) {
  if (!a || !b) return "";
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  return sameMonth ? `${fmt(a, { day: "numeric" })} – ${fmt(b, { day: "numeric", month: "long", year: "numeric" })}` : `${fmt(a, { day: "numeric", month: "long" })} – ${fmt(b, { day: "numeric", month: "long", year: "numeric" })}`;
}
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
const mapped = (items: ShowItem[]) => items.filter((x) => x.lat != null && x.lng != null).map((x) => [x.lng!, x.lat!] as [number, number]);

function ItemIcon({ kind, size = 15 }: { kind: ShowItem["kind"]; size?: number }) {
  if (kind === "event") return <Sparkles size={size} aria-hidden />;
  const I = KIND_ICON[kind];
  return <I size={size} aria-hidden />;
}

/** What a scene is, in a few words (the "next" chip, the bars). */
function labelOf(s: Scene | undefined): string {
  if (!s) return "";
  switch (s.type) {
    case "intro":
      return "The start";
    case "leg":
      return s.to ? `${s.plan ? kindLabel(s.plan.kind) : "On"} to ${s.to.name}` : "Home";
    case "city":
      return s.stop.name;
    case "day":
      return `Day ${s.n} · ${short(s.day)}`;
    case "item":
      return `${s.item.time ? `${s.item.time} ` : ""}${s.item.title}`;
    case "wish":
      return `Places to see in ${s.stop.name}`;
    case "outro":
      return "The trip in numbers";
  }
}

/** The trip as text, day by day (to send to whoever's coming). */
function planText(trip: Trip, scenes: Scene[]): string {
  const out = [`${trip.emoji ?? "✈️"} ${trip.name}, ${longRange(trip.start, trip.end)}`];
  for (const s of scenes) {
    if (s.type === "city") out.push("", `${s.stop.name.toUpperCase()}${s.stay ? ` (sleeping at ${s.stay.title})` : ""}`);
    else if (s.type === "leg" && s.plan) out.push(`  ✈ ${s.plan.title}${s.plan.day ? `, ${short(s.plan.day)}` : ""}${s.plan.time ? ` ${s.plan.time}` : ""}`);
    else if (s.type === "day" && s.items.length) out.push(`Day ${s.n}, ${short(s.day)}`, ...s.items.map((x) => `  ${x.time ?? "·"} ${x.title}${x.place && x.place !== x.title ? `, ${x.place}` : ""}`));
    else if (s.type === "wish") out.push(`  Still to see: ${s.places.map((p) => p.title).join(", ")}`);
  }
  return out.join("\n");
}

/** Something being changed as the show plays. */
type Edit = { kind: "when"; plan: TripPlan; days: string[] } | { kind: "add"; stop: TripStop; day: string | null; title: string };

export function TripShow({
  trip,
  stops,
  events,
  api,
  pad,
  startAt,
  onClose,
}: {
  trip: Trip;
  stops: TripStop[];
  events: { e: TripEvent; day: string }[];
  api: RefObject<EarthMapHandle | null>;
  /** The room the cards and controls take on screen. */
  pad: { top: number; right: number; bottom: number; left: number };
  /** A chapter to start at (a city's id). */
  startAt?: string;
  onClose: () => void;
}) {
  const show = useMemo(() => buildShow({ trip, stops, events }), [trip, stops, events]);
  const { scenes, chapters, stats } = show;
  const first = Math.max(0, startAt ? (chapters.find((c) => c.key === `stop-${startAt}`)?.first ?? 0) : 0);
  const [at, setAt] = useState(first);
  const [epoch, setEpoch] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>(() => {
    try {
      const v = Number(localStorage.getItem(SPEED_KEY));
      return (SPEEDS as readonly number[]).includes(v) ? (v as Speed) : 1;
    } catch {
      return 1;
    }
  });
  const [list, setList] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [peek, setPeek] = useState(false);
  const [dir, setDir] = useState<1 | -1>(1);
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const [bar, setBar] = useState({ total: 1, done: 0, running: false, n: 0 });
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const playBtn = useRef<HTMLButtonElement>(null);
  const timer = useRef(0);
  const clock = useRef({ left: 0, since: 0, total: 0 });
  const landed = useRef(true);
  const spot = useRef<{ remove(): void } | null>(null);
  const lastNav = useRef(0);
  const rush = useRef(false);
  const live = useRef({ at, playing, speed, scenes });
  live.current = { at, playing, speed, scenes };
  const sc: Scene | undefined = scenes[Math.min(at, scenes.length - 1)];
  const points = useMemo(() => stops.map((s) => [s.lng, s.lat] as [number, number]), [stops]);
  // Each day's things (for an item's day: its way on the map, its dots).
  const dayOf = useMemo(() => {
    const m = new Map<string, ShowItem[]>();
    for (const s of scenes) if (s.type === "day") m.set(`${s.stop.id}|${s.day}`, s.items);
    return m;
  }, [scenes]);

  // ---- the camera, for each kind of scene (fast when skipping fast)
  const camera = useCallback(
    (s: Scene, resume = false) => {
      const m = api.current;
      if (!m) return;
      const k = live.current.speed * (rush.current ? 3.2 : 1);
      spot.current?.remove();
      spot.current = null;
      landed.current = false;
      const done = (ok: boolean) => {
        landed.current = ok;
      };
      const routeView = () => {
        m.setPath(null);
        if (points.length) m.viewRoute(points, routeZoom(spread(points)));
        landed.current = true;
      };
      const path = (stop: TripStop, day: string, index: number) => m.setPath(mapped(dayOf.get(`${stop.id}|${day}`) ?? []), stopColor(index));
      switch (s.type) {
        case "intro":
        case "outro":
          return routeView();
        case "leg": {
          m.setPath(null);
          if (!s.to) return routeView();
          const ms = Math.max(rush.current ? 700 : 1400, (s.from && !resume ? legMs(s.km ?? 0) : 2600) / k);
          void m.flyLeg(s.from && !resume ? [s.from.lng, s.from.lat] : null, [s.to.lng, s.to.lat], { zoom: 11.4, pitch: 48, orbitMs: 12000, ms }).then(done);
          return;
        }
        case "city":
          m.setPath(null);
          void m.glideTo([s.stop.lng, s.stop.lat], { zoom: 12.4, pitch: 42, ms: 2200 / k, orbitMs: 14000 }).then(done);
          return;
        case "day": {
          path(s.stop, s.day, s.index);
          const pts = mapped(s.items);
          const all: [number, number][] = pts.length ? pts : [[s.stop.lng, s.stop.lat]];
          void m.glideTo(centre(all), { zoom: pts.length > 1 ? zoomFor(spread(all), 11.5, 14) : 13, pitch: 38, ms: 1900 / k, orbitMs: 12000 }).then(done);
          return;
        }
        case "item": {
          path(s.stop, s.day, s.index);
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
          m.setPath(null);
          const pts = s.places.map((p) => [p.lng!, p.lat!] as [number, number]);
          void m.glideTo(centre(pts), { zoom: zoomFor(spread(pts), 11, 15), pitch: 30, ms: 2000 / k, orbitMs: 12000 }).then(done);
          return;
        }
      }
    },
    [api, points, dayOf],
  );

  // ---- time: each scene runs its time (at the speed chosen), then the next one starts
  const arm = useCallback((left: number, total: number, running: boolean) => {
    window.clearTimeout(timer.current);
    clock.current = { left, since: performance.now(), total };
    setBar((b) => ({ total, done: total - left, running: running && total > 0, n: b.n + 1 }));
    if (running && total > 0)
      timer.current = window.setTimeout(() => {
        rush.current = false;
        setDir(1);
        setAt((i) => Math.min(i + 1, live.current.scenes.length - 1));
      }, left);
  }, []);
  const freeze = useCallback(() => {
    window.clearTimeout(timer.current);
    const c = clock.current;
    c.left = Math.max(0, c.left - (performance.now() - c.since));
    c.since = performance.now();
    setBar((b) => ({ total: c.total, done: c.total - c.left, running: false, n: b.n + 1 }));
  }, []);

  // A new scene: the camera goes, the clock starts once it's on screen.
  useEffect(() => {
    const s = live.current.scenes[at];
    if (!s) return;
    camera(s);
    const total = s.ms ? s.ms / live.current.speed : 0;
    const raf = requestAnimationFrame(() => arm(total, total, live.current.playing));
    // The pictures of what's next, ready before it's on screen.
    for (const n of live.current.scenes.slice(at + 1, at + 3)) {
      if (n.type === "item" && n.item.image) new Image().src = n.item.image;
    }
    return () => cancelAnimationFrame(raf);
  }, [at, epoch, camera, arm]);

  // Pictures for places that have none of their own (their Wikipedia page's), a little ahead.
  useEffect(() => {
    for (const n of scenes.slice(at, at + 3)) {
      if (n.type !== "item" || n.item.image || n.item.kind === "event" || n.item.lat == null || n.item.key in photos) continue;
      const k = n.item.key;
      setPhotos((p) => ({ ...p, [k]: null }));
      const q = new URLSearchParams({ name: n.item.title, lat: String(n.item.lat), lng: String(n.item.lng) });
      fetch(`/api/places/photo?${q}`)
        .then((r) => (r.ok ? r.json() : { photo: null }))
        .then((j: { photo: { image: string } | null }) => {
          if (!j.photo?.image) return;
          new Image().src = j.photo.image;
          setPhotos((p) => ({ ...p, [k]: j.photo!.image }));
        })
        .catch(() => {});
    }
  }, [at, scenes, photos]);

  // The trip changed as it played (an edit): stay on the same part.
  const curKey = useRef(sc?.key);
  useEffect(() => {
    curKey.current = live.current.scenes[at]?.key;
  }, [at]);
  useEffect(() => {
    const i = scenes.findIndex((s) => s.key === curKey.current);
    if (i >= 0 && i !== live.current.at) setAt(i);
    else if (i < 0) setAt((a) => Math.min(a, scenes.length - 1));
  }, [scenes]);

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
  // Going somewhere by hand: twice in quick succession and the camera hurries.
  const go = useCallback((i: number) => {
    const n = live.current.scenes.length;
    const to = Math.max(0, Math.min(n - 1, i));
    const now = performance.now();
    rush.current = now - lastNav.current < 1600;
    lastNav.current = now;
    setDir(to >= live.current.at ? 1 : -1);
    setAt(to);
    setEpoch((e) => e + 1);
  }, []);
  const next = useCallback(() => go(live.current.at + 1), [go]);
  const prev = useCallback(() => go(live.current.at - 1), [go]);
  const chapterOf = (i: number) => chapters.findIndex((c) => i >= c.first && i < c.first + c.count);
  const nextCity = () => {
    const c = chapters[chapterOf(live.current.at) + 1];
    if (c) go(c.first);
  };
  const prevCity = () => {
    const ci = chapterOf(live.current.at);
    const c = chapters[ci];
    // Back to this city's start first, then the one before.
    if (c && live.current.at > c.first) go(c.first);
    else if (chapters[ci - 1]) go(chapters[ci - 1].first);
  };
  const replay = () => {
    setPlaying(true);
    live.current.playing = true;
    go(0);
  };
  const changeSpeed = () => {
    const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    const was = live.current.speed;
    setSpeed(nextSpeed);
    live.current.speed = nextSpeed;
    try {
      localStorage.setItem(SPEED_KEY, String(nextSpeed));
    } catch {
      // not kept
    }
    if (live.current.playing) freeze();
    const c = clock.current;
    arm((c.left * was) / nextSpeed, (c.total * was) / nextSpeed, live.current.playing);
  };

  // Changing something holds the show; done, it goes on.
  const wasPlaying = useRef(false);
  const openEdit = (e: Edit | null) => {
    if (e) {
      if (!edit && !list) wasPlaying.current = live.current.playing;
      setPlay(false);
      setList(false);
    } else {
      if (wasPlaying.current) setPlay(true);
      window.setTimeout(() => playBtn.current?.focus({ preventScroll: true }), 30);
    }
    setEdit(e);
  };
  const openList = (open: boolean) => {
    if (open) {
      if (!edit) wasPlaying.current = live.current.playing;
      setPlay(false);
      setEdit(null);
    } else if (wasPlaying.current) setPlay(true);
    setList(open);
  };

  // ---- changes, from the cards
  const stopDays = (s: TripStop) => daysOf(s.from, s.to);
  const tripDays = stops.length ? daysOf(stops[0].from, stops[stops.length - 1].to) : [];
  const editPlan = (p: TripPlan) => {
    const s = stops.find((x) => p.day && p.day >= x.from && p.day <= x.to) ?? stops.find((x) => p.lat != null && p.lng != null && haversineKm(p.lat, p.lng, x.lat, x.lng) < 40);
    openEdit({ kind: "when", plan: p, days: p.kind === "stay" || !s ? tripDays : stopDays(s) });
  };
  const editHere = () => {
    if (!sc) return;
    if (sc.type === "item" && sc.item.plan) editPlan(sc.item.plan);
    else if (sc.type === "leg" && sc.plan) editPlan(sc.plan);
    else if (sc.type === "day") openEdit({ kind: "add", stop: sc.stop, day: sc.day, title: `Add to ${short(sc.day)} in ${sc.stop.name}` });
    else if (sc.type === "city") {
      if (sc.stay) editPlan(sc.stay);
      else openEdit({ kind: "add", stop: sc.stop, day: sc.stop.from, title: `Where do you sleep in ${sc.stop.name}?` });
    }
  };
  const addTravel = (k: PlanKind, from: TripStop, to: TripStop) => {
    const id = newId();
    userActions.addPlan(trip.id, { id, kind: k, title: `${kindLabel(k)} to ${to.name}`, day: from.to, from: from.name, to: to.name, createdAt: new Date().toISOString() });
    toast({ title: `${kindLabel(k)} to ${to.name}`, body: `${short(from.to)}. Add the time whenever you like.`, emoji: "🧭", action: { label: "Undo", run: () => userActions.removePlan(trip.id, id) } });
  };
  const removeEvent = (e: TripEvent) => {
    userActions.setTripEvent(trip.id, e, false);
    toast({ title: "Taken out of your trip", body: e.title, emoji: "🗑️", action: { label: "Undo", run: () => userActions.setTripEvent(trip.id, e, true) } });
  };
  const share = async () => {
    const text = planText(trip, scenes);
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) await navigator.share({ title: trip.name, text });
      else {
        await navigator.clipboard.writeText(text);
        toast({ title: "The plan is copied", body: "Paste it to whoever's coming.", emoji: "📋" });
      }
    } catch {
      // cancelled
    }
  };

  // Keys: space, arrows (Shift: a city), a city's number, Home, End, E to change, Escape.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === "Escape") {
      e.preventDefault();
      if (edit) openEdit(null);
      else if (list) openList(false);
      else onClose();
      return;
    }
    if (edit || list || t.closest?.("input, textarea, select")) return;
    if (e.key === " " || e.key === "k") {
      if (t.closest?.("button, a") && e.key === " ") return;
      e.preventDefault();
      setPlay(!live.current.playing);
    } else if (e.key === "ArrowRight" || e.key === "l") {
      e.preventDefault();
      if (e.shiftKey) nextCity();
      else next();
    } else if (e.key === "ArrowLeft" || e.key === "j") {
      e.preventDefault();
      if (e.shiftKey) prevCity();
      else prev();
    } else if (e.key === "Home") go(0);
    else if (e.key === "End") go(live.current.scenes.length - 1);
    else if (/^[1-9]$/.test(e.key)) {
      const c = chapters.find((x) => x.index === Number(e.key) - 1);
      if (c) go(c.first);
    } else if (e.key === "e") editHere();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    const onHide = () => document.hidden && setPlay(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [setPlay]);

  // Opening: the keyboard on the play button; closing: the camera stops, the ring and the way go.
  useEffect(() => {
    playBtn.current?.focus({ preventScroll: true });
    api.current?.padTo(pad);
    const m = api.current;
    return () => {
      window.clearTimeout(timer.current);
      spot.current?.remove();
      m?.setPath(null);
      m?.halt();
    };
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // ---- the screen as stories: tap, hold, swipe
  const touch = useRef<{ x: number; y: number; was: boolean; timer: number; moved: boolean; held: boolean } | null>(null);
  const setPull = (dy: number) => {
    const el = stage.current;
    if (!el) return;
    el.style.transform = dy ? `translateY(${Math.round(dy * 0.55)}px)` : "";
    el.style.opacity = dy ? String(Math.max(0.35, 1 - dy / 420)) : "";
  };
  // Anywhere but a button, a field or a panel: the map, the card's words, the picture.
  const free = (t: EventTarget | null) => !(t as HTMLElement | null)?.closest?.("button, a, input, textarea, select, label, .show-sheet, .show-list, .show-controls, .show-top, .show-scrim, .show-next");
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !free(e.target) || edit || list) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const was = live.current.playing;
    touch.current = {
      x: e.clientX,
      y: e.clientY,
      was,
      moved: false,
      held: false,
      timer: window.setTimeout(() => {
        const h = touch.current;
        if (!h || h.moved) return;
        h.held = true;
        setPeek(true);
        if (was) setPlay(false);
      }, 260),
    };
  };
  const onMove = (e: React.PointerEvent) => {
    const h = touch.current;
    if (!h) return;
    const dx = e.clientX - h.x;
    const dy = e.clientY - h.y;
    if (!h.moved && !h.held && Math.hypot(dx, dy) > 14) {
      h.moved = true;
      window.clearTimeout(h.timer);
    }
    if (h.moved && dy > 0 && dy > Math.abs(dx)) setPull(dy);
  };
  const onUp = (e: React.PointerEvent) => {
    const h = touch.current;
    touch.current = null;
    if (!h) return;
    window.clearTimeout(h.timer);
    setPull(0);
    if (h.held) {
      setPeek(false);
      if (h.was) setPlay(true);
      return;
    }
    const dx = e.clientX - h.x;
    const dy = e.clientY - h.y;
    if (h.moved) {
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? nextCity() : prevCity();
      if (dy > 110 && dy > Math.abs(dx)) return onClose();
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.clientX - r.left < r.width * 0.3) prev();
    else next();
  };

  // A simple keyboard trap: Tab stays in the show.
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !box.current) return;
    const f = [...box.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input, textarea, select")].filter((x) => x.offsetParent !== null);
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
  const ch = Math.max(0, sc.chapter);
  const chapter = chapters[ch];
  const ink = "index" in sc ? stopColor(sc.index) : "#6aa5ff";
  const upNext = scenes[at + 1];
  const frac = bar.total ? bar.done / bar.total : 1;

  return createPortal(
    <div
      ref={box}
      className="show"
      role="dialog"
      aria-modal="true"
      aria-label={`${trip.name}: the trip, played`}
      data-type={sc.type}
      data-paused={!playing || undefined}
      data-peek={peek || undefined}
      data-dir={dir < 0 ? "back" : undefined}
      style={{ "--ink": ink } as React.CSSProperties}
      onKeyDown={trap}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => ((touch.current = null), setPull(0), setPeek(false))}
    >
      <div className="show-shade" aria-hidden />
      <div className="show-tap" aria-hidden>
        <span className="show-tap-hint show-tap-prev"><ChevronLeft size={22} /></span>
        <span className="show-tap-hint show-tap-next"><ChevronRight size={22} /></span>
      </div>

      <div className="show-top">
        {/* One bar per part of this city, as stories have. */}
        <div className="show-bars" role="group" aria-label={`Parts of ${chapter?.label ?? "the trip"}`}>
          {scenes.slice(chapter.first, chapter.first + chapter.count).map((s, j) => {
            const i = chapter.first + j;
            const now = i === at;
            return (
              <button key={s.key} type="button" className="show-bar" aria-label={`${labelOf(s)}${now ? " (now)" : ""}`} aria-current={now || undefined} onClick={() => go(i)}>
                <span
                  key={now ? `${at}-${epoch}-${bar.n}` : "x"}
                  className="show-bar-fill"
                  data-running={(now && bar.running && playing) || undefined}
                  style={{ "--from": `${i < at ? 100 : now ? frac * 100 : 0}%`, "--dur": `${Math.max(1, bar.total - bar.done)}ms` } as React.CSSProperties}
                />
              </button>
            );
          })}
        </div>
        <div className="show-topline">
          {/* Every city, as story rings: seen, now, still to come. */}
          <div className="show-rings" role="group" aria-label="Go to a city">
            {chapters.map((c, i) => (
              <button
                key={c.key}
                type="button"
                className="show-ring"
                data-seen={i < ch || undefined}
                aria-current={i === ch || undefined}
                style={{ "--c": c.index != null ? stopColor(c.index) : "#ffd55e" } as React.CSSProperties}
                aria-label={`${c.label}${c.sub ? `, ${c.sub}` : ""}`}
                title={c.label}
                onClick={() => go(c.first)}
              >
                <span>{c.index != null ? c.index + 1 : i === 0 ? <Play size={11} fill="currentColor" aria-hidden /> : <Flag size={11} aria-hidden />}</span>
              </button>
            ))}
          </div>
          <div className="show-titles">
            <p className="show-trip"><span aria-hidden>{trip.emoji ?? "✈️"}</span> {trip.name}</p>
            <p className="show-where">{chapter?.label}{chapter?.sub ? <span> · {chapter.sub}</span> : null}</p>
          </div>
          <button type="button" className="show-icon" aria-label="Close the show" onClick={onClose}><X size={18} aria-hidden /></button>
        </div>
      </div>

      <div ref={stage} className="show-stage">
        {edit ? (
          <section className="show-sheet" aria-label={edit.kind === "add" ? edit.title : `Change ${edit.plan.title}`}>
            <div className="show-sheet-head">
              <p className="show-sheet-h">{edit.kind === "add" ? edit.title : `Change ${edit.plan.title}`}</p>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Done" onClick={() => openEdit(null)}><X size={16} aria-hidden /></button>
            </div>
            {edit.kind === "add" ? (
              <QuickAdd trip={trip} stop={edit.stop} day={edit.day} events={events} onDone={() => openEdit(null)} />
            ) : (
              <WhenPicker
                key={edit.plan.id}
                trip={trip}
                draft={{ title: edit.plan.title, kind: edit.plan.kind, lat: edit.plan.lat, lng: edit.plan.lng, poi: edit.plan.poi, image: edit.plan.image, about: edit.plan.place ?? (edit.plan.poi ? poiLabel(...(edit.plan.poi.split("/") as [string, string?])) : undefined) }}
                days={edit.days}
                initial={edit.plan}
                events={events}
                verb="Save"
                skip={edit.plan.id}
                focusSave
                head={false}
                onCancel={() => openEdit(null)}
                onRemove={() => {
                  const gone = edit.plan;
                  userActions.removePlan(trip.id, gone.id);
                  toast({ title: `${gone.title} taken off`, emoji: "🗑️", action: { label: "Undo", run: () => userActions.addPlan(trip.id, gone) } });
                  openEdit(null);
                }}
                onSave={(w) => {
                  const before = edit.plan;
                  userActions.updatePlan(trip.id, before.id, { day: w.day, time: w.time, endTime: w.endTime, endDay: w.endDay ?? (before.kind === "stay" ? before.endDay : undefined), notes: w.notes });
                  toast({ title: `${before.title}: ${w.day ? `${short(w.day)}${w.time ? `, ${w.time}` : ""}` : "no day yet"}`, emoji: "🗓️", action: { label: "Undo", run: () => userActions.updatePlan(trip.id, before.id, before) } });
                  openEdit(null);
                }}
              />
            )}
          </section>
        ) : (
          <>
            <SceneCard
              key={`${sc.key}-${epoch}`}
              sc={sc}
              trip={trip}
              stops={stops}
              stats={stats}
              dur={sc.ms / speed}
              photo={sc.type === "item" ? (sc.item.image ?? photos[sc.item.key] ?? undefined) : undefined}
              dayItems={sc.type === "item" ? (dayOf.get(`${sc.stop.id}|${sc.day}`) ?? []) : []}
              onJumpItem={(key) => {
                const i = scenes.findIndex((s) => s.key === `item-${key}`);
                if (i >= 0) go(i);
              }}
              onReplay={replay}
              onClose={onClose}
              onShare={() => void share()}
              onEditPlan={editPlan}
              onAddTo={(stop, day, title) => openEdit({ kind: "add", stop, day, title })}
              onTravel={addTravel}
              onRemoveEvent={removeEvent}
            />
            {upNext && sc.type !== "outro" && (
              <button type="button" className="show-next max-lg:hidden" onClick={next}>
                <span className="show-next-k">Next</span> <span className="truncate">{labelOf(upNext)}</span> <ChevronRight size={15} aria-hidden />
              </button>
            )}
          </>
        )}
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

      {(list || edit) && <div className="show-scrim" onClick={() => (edit ? openEdit(null) : openList(false))} aria-hidden />}
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

      <p className="sr-only" aria-live="polite">{sayOf(sc, trip)}</p>
      <p className="show-hint max-lg:hidden" aria-hidden>Space pause · ← → part · Shift ← → city · 1–9 a city · E change · hold to see the map</p>
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

const TRAVEL: PlanKind[] = ["flight", "train", "bus", "car"];

function SceneCard({
  sc,
  trip,
  stops,
  stats,
  dur,
  photo,
  dayItems,
  onJumpItem,
  onReplay,
  onClose,
  onShare,
  onEditPlan,
  onAddTo,
  onTravel,
  onRemoveEvent,
}: {
  sc: Scene;
  trip: Trip;
  stops: TripStop[];
  stats: ReturnType<typeof buildShow>["stats"];
  dur: number;
  photo?: string;
  dayItems: ShowItem[];
  onJumpItem: (key: string) => void;
  onReplay: () => void;
  onClose: () => void;
  onShare: () => void;
  onEditPlan: (p: TripPlan) => void;
  onAddTo: (stop: TripStop, day: string | null, title: string) => void;
  onTravel: (k: PlanKind, from: TripStop, to: TripStop) => void;
  onRemoveEvent: (e: TripEvent) => void;
}) {
  const style = { "--dur": `${Math.max(1200, dur || 6000)}ms` } as React.CSSProperties;
  const i = (n: number) => ({ "--i": n }) as React.CSSProperties;
  switch (sc.type) {
    case "intro":
      return (
        <article className="show-card show-intro" style={style}>
          <p className="show-kicker s-in" style={i(0)}>Your trip</p>
          <h2 className="show-title s-in" style={i(1)}><span aria-hidden>{trip.emoji ?? "✈️"}</span> {trip.name}</h2>
          <p className="show-sub s-in" style={i(2)}>{longRange(trip.start ?? stops[0]?.from, trip.end ?? stops[stops.length - 1]?.to)}</p>
          {stops.length > 0 && (
            <ol className="show-route s-in" style={i(3)} aria-label="The route">
              {stops.map((s, k) => (
                <li key={s.id} style={{ "--c": stopColor(k) } as React.CSSProperties}>
                  <span className="show-n">{k + 1}</span> {s.name}
                </li>
              ))}
            </ol>
          )}
          <p className="show-facts s-in" style={i(4)}>
            {[stats.nights ? `${stats.nights} ${stats.nights === 1 ? "night" : "nights"}` : "", `${stats.cities} ${stats.cities === 1 ? "city" : "cities"}`, stats.km ? `${nf.format(stats.km)} km` : "", stats.planned + stats.events ? `${stats.planned + stats.events} things planned` : ""].filter(Boolean).join(" · ")}
          </p>
          <div className="show-card-actions s-in" style={i(5)}>
            <Link href={`/trips/new?edit=${trip.id}`} className="show-act"><Pencil size={13} aria-hidden /> Change the route</Link>
          </div>
        </article>
      );
    case "leg": {
      const fromName = sc.from?.name ?? sc.plan?.from ?? "Home";
      const toName = sc.to?.name ?? sc.plan?.to ?? "Home";
      const Icon = sc.plan ? KIND_ICON[sc.plan.kind] : KIND_ICON.car;
      return (
        <article className="show-card show-leg" style={style}>
          <p className="show-kicker s-in" style={i(0)}>
            {sc.plan ? kindLabel(sc.plan.kind) : "On the way"}
            {sc.plan?.ref ? ` · ${sc.plan.ref}` : ""}
            {sc.plan?.day ? ` · ${short(sc.plan.day)}` : ""}
          </p>
          <div className="show-pass s-in" style={i(1)}>
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
          <p className="show-sub s-in" style={i(2)}>{sc.km ? `${nf.format(sc.km)} km` : sc.to ? "Into the trip" : "Home again"}</p>
          {sc.plan ? (
            <div className="show-card-actions s-in" style={i(3)}>
              <button type="button" className="show-act" onClick={() => onEditPlan(sc.plan!)}><Pencil size={13} aria-hidden /> Change the time</button>
            </div>
          ) : sc.from && sc.to ? (
            <div className="show-card-actions s-in" style={i(3)}>
              <span className="show-act-q">How do you go?</span>
              {TRAVEL.map((k) => {
                const I = KIND_ICON[k];
                return (
                  <button key={k} type="button" className="show-act" onClick={() => onTravel(k, sc.from!, sc.to!)} aria-label={`By ${kindLabel(k).toLowerCase()}`}>
                    <I size={13} aria-hidden /> {kindLabel(k)}
                  </button>
                );
              })}
            </div>
          ) : null}
        </article>
      );
    }
    case "city": {
      const n = nightsBetween(sc.stop.from, sc.stop.to);
      return (
        <article className="show-card show-city" style={style}>
          <p className="show-kicker s-in" style={i(0)}>
            <span className="show-n" style={{ "--c": stopColor(sc.index) } as React.CSSProperties}>{sc.index + 1}</span> City {sc.index + 1} of {stops.length}
          </p>
          <h2 className="show-title s-in" style={i(1)}>{sc.stop.name} <span aria-hidden>{flagOf(sc.stop.countryCode)}</span></h2>
          <p className="show-sub s-in" style={i(2)}>{short(sc.stop.from)} → {short(sc.stop.to)} · {n} {n === 1 ? "night" : "nights"}</p>
          <p className="show-line s-in" style={i(3)}>
            <BedDouble size={15} aria-hidden /> {sc.stay ? <>Sleeping at <b>{sc.stay.title}</b></> : "No bed booked yet"}
          </p>
          <p className="show-line s-in" style={i(4)}>
            <MapPin size={15} aria-hidden /> {sc.planned ? `${sc.planned} ${sc.planned === 1 ? "thing" : "things"} planned here` : "Nothing planned yet: room to wander"}
          </p>
          <div className="show-card-actions s-in" style={i(5)}>
            {sc.stay ? (
              <button type="button" className="show-act" onClick={() => onEditPlan(sc.stay!)}><BedDouble size={13} aria-hidden /> Change the nights</button>
            ) : (
              <button type="button" className="show-act show-act-main" onClick={() => onAddTo(sc.stop, sc.stop.from, `Where do you sleep in ${sc.stop.name}?`)}><Plus size={13} aria-hidden /> Where you sleep</button>
            )}
            <button type="button" className="show-act" onClick={() => onAddTo(sc.stop, null, `Add to ${sc.stop.name}`)}><Plus size={13} aria-hidden /> Something to do</button>
          </div>
        </article>
      );
    }
    case "day":
      return (
        <article className="show-card show-day" style={style}>
          <p className="show-kicker s-in" style={i(0)}>Day {sc.n} · {sc.stop.name}</p>
          <h2 className="show-title s-in" style={i(1)}>{dayName(sc.day)}</h2>
          {sc.items.length ? (
            <ol className="show-daylist">
              {sc.items.slice(0, 6).map((x, k) => (
                <li key={x.key} className="s-in" style={i(2 + k)} data-kind={x.kind === "event" ? "activity" : x.kind}>
                  <button type="button" onClick={() => onJumpItem(x.key)}>
                    <span className="tnum show-daylist-t">{x.time ?? "Any time"}</span>
                    <span className="show-daylist-i"><ItemIcon kind={x.kind} size={13} /></span>
                    <span className="truncate">{x.title}</span>
                  </button>
                </li>
              ))}
              {sc.items.length > 6 && <li className="s-in show-more" style={i(8)}>and {sc.items.length - 6} more</li>}
            </ol>
          ) : (
            <p className="show-sub s-in" style={i(2)}>A free day in {sc.stop.name}. Wander, or fill it.</p>
          )}
          <div className="show-card-actions s-in" style={i(9)}>
            <button type="button" className="show-act show-act-main" onClick={() => onAddTo(sc.stop, sc.day, `Add to ${short(sc.day)} in ${sc.stop.name}`)}><Plus size={13} aria-hidden /> Add to this day</button>
          </div>
        </article>
      );
    case "item": {
      const x = sc.item;
      const what = x.kind === "event" ? "Event" : kindLabel(x.kind);
      const where = x.place ?? (x.poi ? poiLabel(...(x.poi.split("/") as [string, string?])) : undefined);
      return (
        <article className="show-card show-item" style={style} data-kind={x.kind === "event" ? "activity" : x.kind}>
          {(photo || x.event) && (
            <div className="show-pic">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt="" />
              ) : x.event ? (
                <Poster title={x.event.title} imageUrl={x.event.imageUrl} hue={x.event.posterHue} categorySlug={x.event.categorySlug} size="md" className="h-full w-full" />
              ) : null}
            </div>
          )}
          <div className="show-item-body">
            <p className="show-kicker s-in" style={i(0)}>
              <span className="show-kind"><ItemIcon kind={x.kind} size={13} /></span> {what} · {short(sc.day)}
            </p>
            <p className="show-time tnum s-in" style={i(1)}>{x.time ?? "Any time"}{x.endTime ? <span>–{x.endTime}</span> : null}</p>
            <h2 className="show-title show-title-sm s-in" style={i(2)}>{x.title}</h2>
            {where && <p className="show-sub s-in" style={i(3)}>{where}</p>}
            {x.notes && <p className="show-note s-in" style={i(4)}>“{x.notes}”</p>}
            {/* The day's things as dots: where this one is in it; tap one to go there. */}
            {dayItems.length > 1 && (
              <ol className="show-dots s-in" style={i(5)} aria-label={`${short(sc.day)}: ${sc.n} of ${sc.of}`}>
                {dayItems.map((d) => (
                  <li key={d.key} data-kind={d.kind === "event" ? "activity" : d.kind}>
                    <button type="button" aria-current={d.key === x.key || undefined} aria-label={`${d.time ? `${d.time} ` : ""}${d.title}`} title={`${d.time ? `${d.time} ` : ""}${d.title}`} onClick={() => onJumpItem(d.key)} />
                  </li>
                ))}
              </ol>
            )}
            <div className="show-card-actions s-in" style={i(6)}>
              {x.plan && (
                <button type="button" className="show-act" onClick={() => onEditPlan(x.plan!)}><Pencil size={13} aria-hidden /> Change</button>
              )}
              {x.event && (
                <>
                  <Link href={`/events/${x.event.slug}`} className="show-act" onClick={onClose}>See the event →</Link>
                  <button type="button" className="show-act" onClick={() => onRemoveEvent(x.event!)}><Trash2 size={13} aria-hidden /> Take out</button>
                </>
              )}
            </div>
          </div>
        </article>
      );
    }
    case "wish":
      return (
        <article className="show-card show-wish" style={style}>
          <p className="show-kicker s-in" style={i(0)}>Still on your list</p>
          <h2 className="show-title show-title-sm s-in" style={i(1)}>Places to see in {sc.stop.name}</h2>
          <ul className="show-chips">
            {sc.places.slice(0, 8).map((p, k) => (
              <li key={p.id} className="s-in" style={i(2 + k)} data-kind={p.kind}>
                <button type="button" onClick={() => onEditPlan(p)} aria-label={`Pick a day for ${p.title}`}>
                  <ItemIcon kind={p.kind} size={12} /> {p.title} <Plus size={12} aria-hidden className="opacity-70" />
                </button>
              </li>
            ))}
          </ul>
          <p className="show-sub s-in" style={i(10)}>Tap one to give it a day.</p>
        </article>
      );
    case "outro":
      return (
        <article className="show-card show-outro" style={style}>
          <p className="show-kicker s-in" style={i(0)}>That&apos;s the trip</p>
          <h2 className="show-title s-in" style={i(1)}><span aria-hidden>{trip.emoji ?? "✈️"}</span> {trip.name}</h2>
          <dl className="show-numbers">
            {[
              [stats.nights, stats.nights === 1 ? "night" : "nights"],
              [stats.cities, stats.cities === 1 ? "city" : "cities"],
              [stats.km, "km"],
              [stats.planned, stats.planned === 1 ? "plan" : "plans"],
              [stats.events, stats.events === 1 ? "event" : "events"],
              [stats.toSee, "to see"],
            ]
              .filter(([n], k) => k < 2 || Number(n) > 0)
              .map(([n, label], k) => (
                <div key={String(label)} className="s-in" style={i(2 + k)}>
                  <dt className="tnum">{nf.format(Number(n))}</dt>
                  <dd>{label}</dd>
                </div>
              ))}
          </dl>
          <div className="show-actions s-in" style={i(9)}>
            <button type="button" className="btn btn-primary btn-sm press" onClick={onReplay}><RotateCcw size={14} aria-hidden /> Play again</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onShare}><Share2 size={14} aria-hidden /> Share the plan</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}><Check size={14} aria-hidden /> Back to the trip</button>
          </div>
        </article>
      );
  }
}
