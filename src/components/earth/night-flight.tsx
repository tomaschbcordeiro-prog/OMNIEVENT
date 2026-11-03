"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Pause, Play, Plane, Share2, SkipBack, SkipForward, X } from "lucide-react";
import type { EventCard } from "@/lib/types";
import { haversineKm } from "@/lib/geo";
import { sphereCentre } from "@/lib/map/arc";
import type { EarthMapHandle } from "./earth-map";
import { Poster, SaveButton } from "../ui";
import { toast } from "../toast";

/**
 * Night Flight: a cinematic, self-flying tour of tonight round the planet. A route of real
 * events starting this evening in ten cities, ordered east to west as night falls. The globe
 * flies the great circle to each one behind a golden comet, tilts in and turns slowly while
 * the stop's card shows its local time, then moves on. Pause, skip, save or open any stop.
 */

const VIBES = [
  { id: "any", label: "Anything", emoji: "🌍", groups: [] as string[] },
  { id: "music", label: "Music", emoji: "🎶", groups: ["music"] },
  { id: "stage", label: "Stage & laughs", emoji: "🎭", groups: ["theatre", "comedy"] },
  { id: "party", label: "Party", emoji: "🪩", groups: ["nightlife", "festivals"] },
  { id: "sport", label: "Sport", emoji: "⚽", groups: ["sports"] },
] as const;
type Vibe = (typeof VIBES)[number]["id"];

const STOPS = 10;
const DWELL_MS = 8500;

const GROUP_EMOJI: Record<string, string> = {
  music: "🎶", sports: "⚽", theatre: "🎭", comedy: "😂", festivals: "🎉", cinema: "🎬", conferences: "🎤", technology: "💻",
  exhibitions: "🎨", attractions: "🎡", "food-drink": "🍷", nightlife: "🪩", family: "🧸", outdoor: "🥾", education: "📚", fashion: "👗", culture: "🏛️",
};
const emojiOf = (c: EventCard) => GROUP_EMOJI[c.groupSlug] ?? "✨";
const placeOf = (c: EventCard) => c.city || c.country;
/** A three-letter tag for a place, boarding-pass style. */
const codeOf = (c: EventCard) => placeOf(c).normalize("NFD").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "???";

const hmIn = (t: number, tz: string) => {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
  } catch {
    return "";
  }
};
const dayIn = (t: number, tz: string) => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  } catch {
    return "";
  }
};
function startsIn(ms: number): string {
  if (ms <= 0) return "On now";
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `Starts in ${m} min`;
  return `Starts in ${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
const kmOf = (route: EventCard[], upTo = route.length - 1) => {
  let km = 0;
  for (let i = 1; i <= upTo && i < route.length; i++) km += haversineKm(route[i - 1].lat, route[i - 1].lng, route[i].lat, route[i].lng);
  return Math.round(km);
};

/** Room kept clear at the bottom of the map for the flight's card (phones and tablets). */
export function flightPadBottom(): number {
  if (typeof window === "undefined" || window.innerWidth >= 1024) return 0;
  return Math.round(window.innerHeight * 0.44);
}

/** The query for a route with a vibe. */
export function flightQuery(vibe: Vibe): string {
  const p = new URLSearchParams({ n: String(STOPS) });
  const groups = VIBES.find((v) => v.id === vibe)?.groups ?? [];
  if (groups.length) p.set("cat", groups.join(","));
  return p.toString();
}

const stopsOf = (r: EventCard[]) => r.map((c) => [c.lng, c.lat] as [number, number]);
/** The whole planet in the room left between the letterbox, the card and any side panel. */
const routeZoom = (r: EventCard[]) => {
  const lat = Math.max(-45, Math.min(45, sphereCentre(stopsOf(r))[1]));
  const bar = Math.min(64, Math.max(34, window.innerHeight * 0.07));
  const w = window.innerWidth - (window.innerWidth >= 1024 ? 400 : 0);
  const h = window.innerHeight - flightPadBottom() - 2 * bar;
  const radius = 0.44 * Math.min(w, h);
  return Math.max(0, Math.min(2.2, Math.log2((radius * 2 * Math.PI * Math.max(0.2, Math.cos((lat * Math.PI) / 180))) / 512)));
};

type Phase = "loading" | "boarding" | "flying" | "at" | "finale" | "empty" | "error";

const preload = (c?: EventCard) => {
  if (c?.imageUrl) new Image().src = c.imageUrl;
};

export function NightFlight({
  map,
  ready,
  reduced,
  interrupt,
  onStop,
  onFinale,
  onOpen,
  onExit,
}: {
  map: () => EarthMapHandle | null;
  /** The map can draw and fly. */
  ready: boolean;
  reduced: boolean;
  /** Changes whenever someone grabs the map: the flight pauses. */
  interrupt: number;
  /** The stop on screen (ringed on the globe), or null between stops. */
  onStop: (c: EventCard | null) => void;
  /** The route is complete: let the planet turn with the trail on it. */
  onFinale: (on: boolean) => void;
  onOpen: (c: EventCard) => void;
  onExit: () => void;
}) {
  const [vibe, setVibe] = useState<Vibe>("any");
  const [route, setRoute] = useState<EventCard[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [at, setAt] = useState(-1);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [said, setSaid] = useState("");
  /** Each command bumps this; async steps from an older one stop. */
  const run = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dwell = useRef({ left: DWELL_MS, since: 0 });
  const landed = useRef(false);
  const takeoffRef = useRef<HTMLButtonElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  const live = useRef({ route, at, phase, paused });
  live.current = { route, at, phase, paused };

  const load = useCallback(
    async (v: Vibe) => {
      const id = ++run.current;
      clearTimeout(timer.current);
      setPhase("loading");
      setAt(-1);
      setPaused(false);
      onStop(null);
      onFinale(false);
      try {
        const r = await fetch(`/api/night-flight?${flightQuery(v)}`);
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { items: EventCard[] };
        if (id !== run.current) return;
        setRoute(j.items);
        const m = map();
        if (j.items.length < 2) {
          m?.setFlight(null);
          return setPhase("empty");
        }
        m?.setFlight({ stops: stopsOf(j.items), reached: -1 });
        m?.viewRoute(stopsOf(j.items), routeZoom(j.items));
        setPhase("boarding");
        j.items.slice(0, 2).forEach(preload);
        requestAnimationFrame(() => takeoffRef.current?.focus({ preventScroll: true }));
      } catch {
        if (id === run.current) setPhase("error");
      }
    },
    [map, onStop, onFinale],
  );

  // The route is charted once the globe is ready.
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void load("any");
  }, [ready, load]);

  const startDwell = (ms: number) => {
    clearTimeout(timer.current);
    dwell.current = { left: ms, since: performance.now() };
    timer.current = setTimeout(() => next(), ms);
  };

  const fly = async (i: number, from: number | null) => {
    const { route: r } = live.current;
    const m = map();
    const c = r[i];
    if (!m || !c) return;
    const id = ++run.current;
    clearTimeout(timer.current);
    landed.current = false;
    setAt(i);
    setPaused(false);
    setPhase("flying");
    onStop(null);
    preload(r[i + 1]);
    m.setFlight({ stops: stopsOf(r), reached: i - 1 });
    const ok = await m.flyLeg(from == null ? null : [r[from].lng, r[from].lat], [c.lng, c.lat], { zoom: 12, orbitMs: reduced ? 0 : DWELL_MS + 2500 });
    if (id !== run.current) return;
    landed.current = ok;
    if (ok) m.setFlight({ stops: stopsOf(r), reached: i });
    onStop(c);
    setPhase("at");
    setNow(Date.now());
    setSaid(`Stop ${i + 1} of ${r.length}: ${placeOf(c)}. ${c.title}.`);
    if (ok) startDwell(DWELL_MS);
    else {
      dwell.current = { left: DWELL_MS, since: 0 };
      setPaused(true);
    }
  };

  const finale = () => {
    const { route: r } = live.current;
    ++run.current;
    clearTimeout(timer.current);
    const m = map();
    m?.setFlight({ stops: stopsOf(r), reached: r.length - 1 });
    m?.viewRoute(stopsOf(r), routeZoom(r));
    onStop(null);
    setPhase("finale");
    setSaid(`Touchdown. You followed the night through ${r.length} cities.`);
    requestAnimationFrame(() => againRef.current?.focus({ preventScroll: true }));
    // Once the camera has pulled back, the planet turns with the whole trail on it.
    if (!reduced) timer.current = setTimeout(() => onFinale(true), 3400);
  };

  function next() {
    const { route: r, at: i } = live.current;
    if (i >= r.length - 1) return finale();
    void fly(i + 1, i);
  }
  const prev = () => {
    const { at: i } = live.current;
    if (i > 0) void fly(i - 1, i);
  };
  const takeoff = () => void fly(0, null);

  const pause = () => {
    const { phase: p, paused: was } = live.current;
    if (was) return;
    if (p === "flying") {
      // Halting the camera ends the leg; the stop's card shows, paused.
      map()?.halt();
      return;
    }
    if (p !== "at") return;
    clearTimeout(timer.current);
    dwell.current.left = Math.max(1200, dwell.current.left - (performance.now() - dwell.current.since));
    setPaused(true);
  };
  const resume = () => {
    if (live.current.phase !== "at") return;
    // A leg that was interrupted is flown again from wherever the camera is now.
    if (!landed.current) return void fly(live.current.at, null);
    setPaused(false);
    startDwell(dwell.current.left);
  };
  const toggle = () => {
    const { phase: p, paused: was } = live.current;
    if (p === "boarding") return takeoff();
    if (was) resume();
    else pause();
  };

  const exit = useCallback(() => {
    ++run.current;
    clearTimeout(timer.current);
    const m = map();
    m?.halt();
    m?.setFlight(null);
    onStop(null);
    onFinale(false);
    onExit();
  }, [map, onStop, onFinale, onExit]);

  // Someone grabbed the map: hold the flight where it is.
  const seen = useRef(interrupt);
  useEffect(() => {
    if (interrupt === seen.current) return;
    seen.current = interrupt;
    const p = live.current.phase;
    if (p === "at") pause();
    if (p === "finale") onFinale(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interrupt]);

  // A hidden tab holds the flight too.
  useEffect(() => {
    const on = () => document.hidden && pause();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Local clocks tick over.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  // Keys: space pauses, arrows skip, Escape leaves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Escape") return exit();
      const p = live.current.phase;
      if (p !== "at" && p !== "flying") return;
      const act = e.key === "ArrowRight" ? next : e.key === "ArrowLeft" ? prev : e.key === " " && !t?.closest("button, a") ? toggle : null;
      if (!act) return;
      e.preventDefault();
      act();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exit]);

  // Leaving the page mid-flight clears the route and timers.
  useEffect(
    () => () => {
      ++run.current;
      clearTimeout(timer.current);
      const m = map();
      m?.halt();
      m?.setFlight(null);
    },
    [map],
  );

  // Full immersion: the site header steps aside while flying.
  useEffect(() => {
    document.body.classList.add("nf-on");
    return () => document.body.classList.remove("nf-on");
  }, []);

  const totalKm = useMemo(() => kmOf(route), [route]);
  const countries = useMemo(() => new Set(route.map((c) => c.country).filter(Boolean)).size, [route]);
  const stop = at >= 0 ? route[at] : undefined;
  const nextStop = phase === "flying" ? stop : undefined;
  const legKm = phase === "flying" && at > 0 ? Math.round(haversineKm(route[at - 1].lat, route[at - 1].lng, route[at].lat, route[at].lng)) : null;

  const choose = (v: Vibe) => {
    setVibe(v);
    void load(v);
  };

  const share = async () => {
    const url = `${location.origin}/?flight=1`;
    const text = `✈ I followed tonight round the planet on OMNIEVENT: ${route.map(placeOf).join(" → ")}`;
    try {
      if (navigator.share) await navigator.share({ title: "Night Flight", text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast({ title: "Link copied", emoji: "📋" });
      }
    } catch {
      // the share sheet was closed
    }
  };

  const cardPos = "absolute z-[52] inset-x-3 bottom-[calc(var(--nf-bar)+0.75rem)] sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[420px] lg:left-auto lg:translate-x-0 lg:right-6 lg:w-[370px]";

  return (
    <section aria-label="Night Flight" className="nf-root fixed inset-0 z-50 pointer-events-none">
      <p className="sr-only" aria-live="polite">{said}</p>
      <div className="nf-vignette" aria-hidden />
      {/* Letterbox: the page turns into a film. */}
      <div className="nf-bar nf-bar--top pointer-events-auto">
        <div className="mx-auto flex h-full max-w-[1400px] items-center gap-3 px-4 sm:px-6">
          <p className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--gold-light)]">
            <span className="nav-premium-star !text-[var(--gold-light)]" aria-hidden>✦</span> Night Flight
          </p>
          {route.length > 1 && phase !== "loading" && (
            <ol className="flex flex-1 items-center gap-1" aria-label={`Stop ${Math.max(1, at + 1)} of ${route.length}`}>
              {route.map((c, i) => {
                const done = phase === "finale" || i < at;
                const current = i === at && (phase === "at" || phase === "flying");
                return (
                  <li key={c.id} className="nf-seg" title={placeOf(c)}>
                    {done ? <span className="nf-seg-fill w-full" /> : current && phase === "at" ? <span key={`${at}-${phase}`} className="nf-seg-fill nf-seg-run" style={{ animationDuration: `${DWELL_MS}ms`, animationPlayState: paused ? "paused" : "running" }} /> : current ? <span className="nf-seg-fly" /> : null}
                  </li>
                );
              })}
            </ol>
          )}
          <button type="button" onClick={exit} className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[12px] font-semibold text-white hover:bg-white/20 press">
            <X size={13} aria-hidden /> <span className="max-sm:sr-only">Exit flight</span>
          </button>
        </div>
      </div>
      <div className="nf-bar nf-bar--bottom" />

      {/* In the air: where we're heading. */}
      {nextStop && (
        <div className="nf-hud absolute left-1/2 top-[calc(var(--nf-bar)+0.9rem)] -translate-x-1/2 rounded-full px-4 py-2 text-white" role="status">
          <p className="flex items-center gap-2 whitespace-nowrap text-[13px] font-semibold">
            <Plane size={14} className="nf-plane text-[var(--gold-light)]" aria-hidden />
            Next stop: {placeOf(nextStop)}
            {nextStop.country && nextStop.city ? <span className="text-white/65 font-medium max-sm:hidden">· {nextStop.country}</span> : null}
            {legKm ? <span className="text-white/65 font-medium tnum">· {legKm.toLocaleString()} km</span> : null}
          </p>
        </div>
      )}

      {/* ---- Boarding pass ---- */}
      {(phase === "loading" || phase === "boarding" || phase === "empty" || phase === "error") && (
        <div className={`${cardPos} nf-card nf-pass pointer-events-auto`}>
          <div className="px-5 pt-4 pb-3">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-[var(--gold)]">Boarding pass · Tonight</p>
            {phase === "boarding" && route.length > 1 ? (
              <>
                <div className="mt-2 flex items-center gap-3">
                  <div className="min-w-0">
                    <p className="nf-code">{codeOf(route[0])}</p>
                    <p className="truncate text-[12px] text-white/70">{placeOf(route[0])}</p>
                  </div>
                  <div className="nf-route flex-1" aria-hidden>
                    <Plane size={16} className="text-[var(--gold-light)]" />
                  </div>
                  <div className="min-w-0 text-right">
                    <p className="nf-code">{codeOf(route[route.length - 1])}</p>
                    <p className="truncate text-[12px] text-white/70">{placeOf(route[route.length - 1])}</p>
                  </div>
                </div>
                <p className="mt-3 text-[13.5px] leading-snug text-white/85">
                  <span className="sm:hidden">Follow tonight round the planet, city by city, as night falls.</span>
                  <span className="max-sm:hidden">Follow tonight round the planet: {route.length} cities where the evening is just beginning, from where night falls first to where it falls last.</span>
                </p>
              </>
            ) : phase === "empty" ? (
              <p className="mt-3 text-[14px] text-white/85">Not enough of that tonight to make a route. Try another vibe.</p>
            ) : phase === "error" ? (
              <p className="mt-3 text-[14px] text-white/85">Couldn&apos;t chart tonight&apos;s route. <button type="button" className="underline font-semibold" onClick={() => void load(vibe)}>Try again</button></p>
            ) : (
              <p className="mt-3 flex items-center gap-2 text-[14px] text-white/85">
                <Loader2 size={15} className="animate-spin text-[var(--gold-light)]" aria-hidden /> Charting tonight&apos;s route…
              </p>
            )}
          </div>
          <div className="nf-perf" aria-hidden />
          <div className="px-5 pt-3 pb-4">
            {phase === "boarding" && (
              <dl className="grid grid-cols-3 gap-2 text-white">
                {[
                  ["Stops", String(route.length)],
                  ["Distance", `${totalKm.toLocaleString()} km`],
                  ["Countries", String(countries)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">{k}</dt>
                    <dd className="mt-0.5 text-[15px] font-bold tnum">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div role="group" aria-label="Vibe" className="mt-3 flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
              {VIBES.map((v) => (
                <button key={v.id} type="button" aria-pressed={vibe === v.id} disabled={phase === "loading"} onClick={() => choose(v.id)} className={`nf-chip press shrink-0 ${vibe === v.id ? "nf-chip--on" : ""}`}>
                  <span aria-hidden>{v.emoji}</span> {v.label}
                </button>
              ))}
            </div>
            <button ref={takeoffRef} type="button" disabled={phase !== "boarding"} onClick={takeoff} className="btn btn-gold press mt-3 w-full justify-center disabled:opacity-60">
              <Plane size={17} aria-hidden /> Take off
            </button>
          </div>
        </div>
      )}

      {/* ---- At a stop ---- */}
      {phase === "at" && stop && (
        <article key={stop.id} className={`${cardPos} nf-card nf-card-in pointer-events-auto overflow-hidden`} aria-label={`${placeOf(stop)}: ${stop.title}`}>
          <button type="button" onClick={() => onOpen(stop)} className="group relative block w-full text-left">
            <Poster title={stop.title} imageUrl={stop.imageUrl} hue={stop.posterHue} categorySlug={stop.categorySlug} priority className="aspect-[2/1] sm:aspect-[16/9] w-full transition-transform duration-700 group-hover:scale-[1.03]" />
            <span className="absolute inset-0 bg-gradient-to-t from-[#070b1d] via-[#070b1d]/55 to-transparent" aria-hidden />
            <span className="absolute left-3 top-3 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-bold tnum text-white backdrop-blur">{at + 1} / {route.length}</span>
            <span className="absolute inset-x-0 bottom-0 p-4 pb-3 text-white">
              <span className="flex items-baseline gap-2">
                <span className="nf-time tnum">{hmIn(Date.parse(stop.start), stop.timeZone)}</span>
                <span className="text-[12px] font-semibold text-white/80">
                  🌙 {dayIn(Date.parse(stop.start), stop.timeZone) === dayIn(now, stop.timeZone) ? "Tonight" : "Tomorrow night"} · {placeOf(stop)} time
                </span>
              </span>
              <span className="mt-1 block text-[18px] font-bold leading-tight line-clamp-2">{stop.title}</span>
            </span>
          </button>
          <div className="px-4 pb-4">
            <p className="truncate text-[12.5px] text-white/75">
              {emojiOf(stop)} {stop.venueName}
              {stop.city ? `, ${stop.city}` : ""}
              {stop.country ? ` · ${stop.country}` : ""}
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] tnum">
              <span className={Date.parse(stop.start) <= now ? "inline-flex items-center gap-1.5 font-bold text-[#ff8da1]" : "font-semibold text-[var(--gold-light)]"}>
                {Date.parse(stop.start) <= now && <span className="live-dot live-dot--on" aria-hidden />}
                {startsIn(Date.parse(stop.start) - now)}
              </span>
              <span className="text-white/60">It&apos;s {hmIn(now, stop.timeZone)} there now</span>
              {stop.isFree && <span className="rounded-full bg-ok/90 px-2 py-0.5 text-[10.5px] font-bold text-white">Free</span>}
            </p>
            <div className="mt-3 flex items-center gap-1.5">
              <button type="button" className="btn btn-gold btn-sm press flex-1 justify-center" onClick={() => onOpen(stop)}>Open event</button>
              <SaveButton id={stop.id} title={stop.title} compact className="nf-icon" />
              <span className="mx-0.5 h-6 w-px bg-white/15" aria-hidden />
              <button type="button" className="nf-icon btn btn-sm btn-icon press" aria-label="Previous stop" disabled={at === 0} onClick={prev}>
                <SkipBack size={15} aria-hidden />
              </button>
              <button type="button" className="nf-icon btn btn-sm btn-icon press" aria-label={paused ? "Resume the flight" : "Pause the flight"} onClick={toggle}>
                {paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
              </button>
              <button type="button" className="nf-icon btn btn-sm btn-icon press" aria-label={at === route.length - 1 ? "Finish the flight" : "Next stop"} onClick={next}>
                <SkipForward size={15} aria-hidden />
              </button>
            </div>
            {paused && <p className="mt-2 text-[11.5px] text-white/60">Paused. Look around, then press play to fly on.</p>}
          </div>
        </article>
      )}

      {/* ---- Touchdown ---- */}
      {phase === "finale" && (
        <section className={`${cardPos} nf-card nf-card-in pointer-events-auto p-5`} aria-label="Flight complete">
          <span className="absolute right-8 top-6" aria-hidden>
            <span className="burst">
              {Array.from({ length: 16 }, (_, i) => (
                <i key={i} style={{ ["--c" as string]: ["#ffe29a", "#f5c451", "#ffffff", "#ffb800"][i % 4], ["--r" as string]: `${(i * 360) / 16}deg`, ["--d" as string]: `${40 + (i % 3) * 16}px` }} />
              ))}
            </span>
          </span>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-[var(--gold)]">✦ Touchdown</p>
          <p className="mt-1 text-[20px] font-bold leading-tight text-white">
            You followed the night <span className="gold-text">round the planet</span>
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-white">
            {[
              ["Cities", String(route.length)],
              ["Countries", String(countries)],
              ["Flown", `${totalKm.toLocaleString()} km`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">{k}</dt>
                <dd className="mt-0.5 text-[15px] font-bold tnum">{v}</dd>
              </div>
            ))}
          </dl>
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Your stops">
            {route.map((c) => (
              <li key={c.id}>
                <button type="button" className="nf-chip press max-w-44" title={c.title} onClick={() => onOpen(c)}>
                  <span aria-hidden>{emojiOf(c)}</span> <span className="truncate">{placeOf(c)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-2">
            <button ref={againRef} type="button" className="btn btn-gold btn-sm press flex-1 justify-center" onClick={() => void load(vibe)}>
              <Plane size={15} aria-hidden /> Fly again
            </button>
            <button type="button" className="nf-icon btn btn-sm btn-icon press" aria-label="Share your flight" onClick={() => void share()}>
              <Share2 size={15} aria-hidden />
            </button>
            <button type="button" className="nf-icon btn btn-sm press px-3" onClick={exit}>Back to the globe</button>
          </div>
        </section>
      )}
    </section>
  );
}
