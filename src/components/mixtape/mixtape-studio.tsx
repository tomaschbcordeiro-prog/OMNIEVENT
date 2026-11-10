"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { TripButton } from "../trips/trip-add";
import { BookmarkPlus, CalendarPlus, Check, ChevronDown, Dices, Headphones, Lock, LockOpen, Minus, Play, Plus, Search, Share2, Shuffle, Square, Trash2, X } from "lucide-react";
import { addTrack, BUDGET, DEFAULT_VIBE, ENERGY, fillTape, hop, localMinutes, MOODS, RANGE, rerollTrack, tapeDay, tapeHue, tapeName, tapeStats, type MixCandidate, type TapeContext, type Track, type Vibe } from "@/lib/mixtape/plan";
import { tapeWindow, windowLabel, WHEN, addDays, type WhenKind } from "@/lib/mixtape/windows";
import { parseTapeQuery, tapeIcs, tapeQuery, type TapeLink } from "@/lib/mixtape/share";
import { convert } from "@/lib/currency";
import { formatMoney } from "@/lib/format";
import { getCategory, GROUP_HEX } from "@/lib/categories";
import { todayIn } from "@/lib/time";
import { userActions } from "@/lib/user/store";
import { weatherLook } from "@/lib/weather-look";
import { useForecast } from "../weather";
import { CategoryIcon, Poster } from "../ui";
import { toast } from "../toast";
import { Cassette } from "./cassette";
import { RouteMap, type RouteStop } from "./route-map";

export interface MixCity {
  id: string;
  name: string;
  country: string;
  tz: string;
  currency: string;
  lat: number;
  lng: number;
  /** Events listed there. */
  n: number;
}

interface Pool {
  key: string;
  items: MixCandidate[];
  total: number;
}

interface ShelfTape {
  q: string;
  name: string;
  city: string;
  hue: number;
  tracks: number;
  at: number;
}

const SHELF_KEY = "omnievent:mixtapes:v1";
const LAST_KEY = "omnievent:mixtape-last:v1";
const MAX_TRACKS = 8;
const PLAY_MS = 3400;

function readShelf(): ShelfTape[] {
  try {
    const list = JSON.parse(localStorage.getItem(SHELF_KEY) ?? "[]") as ShelfTape[];
    return Array.isArray(list) ? list.filter((x) => x && typeof x.q === "string" && typeof x.name === "string").slice(0, 12) : [];
  } catch {
    return [];
  }
}
function writeShelf(list: ShelfTape[]) {
  try {
    localStorage.setItem(SHELF_KEY, JSON.stringify(list.slice(0, 12)));
  } catch {
    // private mode: the shelf lasts for this visit only
  }
}

const pad = (i: number) => String(i).padStart(2, "0");
const duration = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, "0")}` : ""}`);
const km = (k: number) => (k < 1 ? `${Math.round(k * 100) * 10} m` : `${k.toFixed(k < 10 ? 1 : 0)} km`);
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const seedOf = (s: string) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);

/** What to do with a free stretch between two tracks, from when it falls. */
function gapNote(from: number, to: number, tz: string): string | null {
  const min = Math.round((to - from) / 60000);
  if (min < 45) return null;
  const a = localMinutes(from, tz);
  const b = a + min;
  const spans = (x: number, y: number) => a <= x && b >= y;
  if (min >= 75 && (spans(19 * 60 + 30, 20 * 60 + 45) || spans(20 * 60, 21 * 60 + 15))) return `🍽️ ${duration(min)} free: time for dinner`;
  if (min >= 60 && spans(12 * 60 + 45, 13 * 60 + 45)) return `🥪 ${duration(min)} free: lunch break`;
  return `☕ ${duration(min)} to spare`;
}

/**
 * Mixtape: plan a night or a weekend in a city like a mixtape. Choose the city, when and the
 * vibe; the tape records itself from real events, in order, with time to get between them.
 * Shuffle, lock, swap or drop tracks, play it on the map, then share it, put it in your
 * calendar or keep it on your shelf.
 */
export function MixtapeStudio({ cities, link, here, when }: { cities: MixCity[]; link: TapeLink | null; /** The visitor's city, and whether they chose it (or their device found it). */ here?: { id: string; chosen: boolean } | null; /** Start on this window (a link without a tape). */ when?: WhenKind }) {
  const [now, setNow] = useState<number | null>(null);
  const [cityId, setCityId] = useState(link?.city ?? "");
  const [kind, setKind] = useState<WhenKind>(link?.kind ?? "weekend");
  const [dates, setDates] = useState({ from: link?.fromDate ?? "", to: link?.toDate ?? "" });
  const [vibe, setVibe] = useState<Vibe>(link?.vibe ?? DEFAULT_VIBE);
  const [n, setN] = useState<number | null>(link?.tracks.length || null);
  const [customName, setCustomName] = useState(link?.name ?? "");
  const [pool, setPool] = useState<Pool | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [tape, setTape] = useState<Track[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);
  const [pointed, setPointed] = useState<number | null>(null);
  const [shared, setShared] = useState(false);
  const [shelf, setShelf] = useState<ShelfTape[]>([]);
  const [saved, setSaved] = useState(false);
  const [announce, setAnnounce] = useState("");
  const pending = useRef<TapeLink | null>(null);
  const seen = useRef(new Set<string>());
  const tapeNow = useRef<Track[]>([]);
  tapeNow.current = tape;
  const spinTimer = useRef<number | undefined>(undefined);

  const city = cities.find((c) => c.id === cityId);
  const win = useMemo(() => (now != null && city ? tapeWindow(kind, city.tz, now, dates) : null), [now, city, kind, dates]);
  const byId = useMemo(() => new Map((pool?.items ?? []).map((c) => [c.id, c])), [pool]);
  const target = n ?? win?.tracks ?? 4;
  const hue = tapeHue(vibe.energy);
  const caps = useMemo(() => BUDGET.map((b) => (Number.isFinite(b.capEur) && b.capEur > 0 ? convert(b.capEur, "EUR", city?.currency ?? "EUR") ?? b.capEur : b.capEur)), [city?.currency]);
  const ctx: TapeContext | null = useMemo(
    () => (city && win ? { tz: city.tz, from: win.from, to: win.to, vibe, caps, centre: { lat: city.lat, lng: city.lng } } : null),
    [city, win, vibe, caps],
  );
  const autoName = city ? tapeName(city.name, vibe, seedOf(`${city.id}${kind}`)) : "Your mixtape";
  const name = customName.trim() || autoName;
  const money = (v: number) => formatMoney(v >= 20 ? Math.round(v) : Math.round(v * 100) / 100, city?.currency ?? "EUR");

  const spin = useCallback(() => {
    setSpinning(true);
    window.clearTimeout(spinTimer.current);
    spinTimer.current = window.setTimeout(() => setSpinning(false), 950);
  }, []);

  /** Opens a tape from a link (on arrival, or from the shelf). */
  const openLink = useCallback(
    (l: TapeLink, at: number) => {
      const c = cities.find((x) => x.id === l.city);
      if (!c) return false;
      setCityId(c.id);
      setVibe(l.vibe);
      setCustomName(l.name ?? "");
      setPlaying(null);
      const live = l.tracks.filter((t) => t.end > at);
      if (l.tracks.length && !live.length) {
        toast({ title: "That tape has already played", body: "Here's a fresh one for this weekend.", emoji: "📼" });
        setKind("weekend");
        setN(null);
        pending.current = null;
        setShared(false);
        return true;
      }
      const w = l.fromDate ? tapeWindow(l.kind, c.tz, at, { from: l.fromDate, to: l.toDate }) : null;
      if (l.fromDate && w && l.kind !== "dates" && w.fromDate !== l.fromDate) {
        setKind("dates");
        setDates({ from: l.fromDate, to: l.toDate || l.fromDate });
      } else {
        setKind(l.kind);
        if (l.kind === "dates") setDates({ from: l.fromDate, to: l.toDate || l.fromDate });
      }
      pending.current = live.length ? { ...l, tracks: live } : null;
      setShared(live.length > 0);
      setN(live.length || null);
      return true;
    },
    [cities],
  );

  // Arrival: a shared tape, or the city and vibe used last time, or the city nearest in time zone.
  useEffect(() => {
    const at = Date.now();
    setNow(at);
    setShelf(readShelf());
    if (link && openLink(link, at)) return;
    if (when) setKind(when);
    let last: { city?: string; vibe?: Vibe } = {};
    try {
      last = JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}");
    } catch {
      // nothing remembered
    }
    if (last.vibe && typeof last.vibe.energy === "number") setVibe({ ...DEFAULT_VIBE, ...last.vibe, moods: Array.isArray(last.vibe.moods) ? last.vibe.moods : [] });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // A city they chose (or their device found) first, then the one used last time, then the one
    // their connection is in, then the busiest in their time zone.
    const byId = (id?: string) => (id ? cities.find((c) => c.id === id) : undefined);
    const pick = (here?.chosen ? byId(here.id) : undefined) ?? byId(last.city) ?? byId(here?.id) ?? cities.filter((c) => c.tz === tz).sort((a, b) => b.n - a.n)[0] ?? cities[0];
    if (pick) setCityId(pick.id);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember the city and vibe for next time.
  useEffect(() => {
    if (!cityId) return;
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ city: cityId, vibe }));
    } catch {
      // private mode
    }
  }, [cityId, vibe]);

  // The pool of events for this city and these dates.
  const poolKey = city && win ? `${city.id}|${win.fromDate}|${win.toDate}` : "";
  useEffect(() => {
    if (!poolKey || !city || !win) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    spin();
    const inc = pending.current?.city === city.id ? `&include=${encodeURIComponent(pending.current.tracks.map((t) => t.id).join(","))}` : "";
    fetch(`/api/mixtape?city=${city.id}&from=${win.fromDate}&to=${win.toDate}${inc}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { items: MixCandidate[]; total: number }) => {
        seen.current = new Set();
        setPool({ key: poolKey, items: j.items, total: j.total });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setError("We couldn't load events for this city just now. Try again in a moment.");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // The key stands for the city and the dates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey, attempt]);

  /** Records a new tape: locked tracks stay, the rest is drawn again. */
  const record = useCallback(
    (want: number) => {
      if (!pool || !ctx || pool.key !== poolKey) return;
      const old = tapeNow.current;
      old.forEach((t) => seen.current.add(t.id));
      if (seen.current.size > pool.items.length * 0.6) seen.current = new Set(old.map((t) => t.id));
      const keep = old.filter((t) => t.locked && byId.has(t.id) && t.start >= ctx.from && t.start < ctx.to);
      const next = fillTape(pool.items, ctx, keep, { n: want, seen: seen.current });
      setTape(next);
      setPlaying(null);
      spin();
      setAnnounce(`New tape: ${next.length} track${next.length === 1 ? "" : "s"}.`);
    },
    [pool, ctx, poolKey, byId, spin],
  );

  // A new tape when the pool arrives or the vibe changes (a shared tape arrives as it was).
  const vibeKey = JSON.stringify(vibe);
  useEffect(() => {
    if (!pool || pool.key !== poolKey || !ctx) return;
    const l = pending.current;
    if (l && l.city === cityId) {
      pending.current = null;
      const got = l.tracks.filter((t) => byId.has(t.id));
      if (got.length) {
        setTape(got);
        spin();
        return;
      }
      setShared(false);
    }
    const t = window.setTimeout(() => record(n ?? win?.tracks ?? 4), tapeNow.current.length ? 160 : 0);
    return () => window.clearTimeout(t);
    // Only when the pool, the window or the vibe change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, vibeKey, win?.from, win?.to]);

  // More or fewer tracks: add where they fit, or drop the last unlocked ones.
  const setCount = (want: number) => {
    const v = Math.max(1, Math.min(MAX_TRACKS, want));
    setN(v);
    if (!pool || !ctx) return;
    if (v > tape.length) {
      const next = fillTape(pool.items, ctx, tape, { n: v, seen: seen.current });
      if (next.length === tape.length) toast({ title: "Nothing else fits", body: "Try more days, a wider range or a bigger budget.", emoji: "🎚️" });
      setTape(next);
      spin();
    } else if (v < tape.length) {
      const drop = [...tape].reverse().find((t) => !t.locked) ?? tape[tape.length - 1];
      setTape(tape.filter((t) => t !== drop));
    }
  };

  const shuffle = () => {
    setShared(false);
    record(target);
  };
  const reroll = (i: number) => {
    if (!pool || !ctx) return;
    const next = rerollTrack(pool.items, ctx, tape, i, seen.current);
    if (next === tape) return toast({ title: "No other track fits there", body: "Unlock a neighbour or widen the range.", emoji: "🎲" });
    seen.current.add(tape[i].id);
    setTape(next);
    spin();
  };
  const toggleLock = (i: number) => {
    setTape(tape.map((t, j) => (j === i ? { ...t, locked: !t.locked || undefined } : t)));
    try {
      navigator.vibrate?.(12);
    } catch {
      // no vibration
    }
  };
  const remove = (i: number) => {
    setTape(tape.filter((_, j) => j !== i));
    setN(Math.max(1, tape.length - 1));
    if (playing != null) setPlaying(null);
  };
  const add = () => {
    if (!pool || !ctx) return;
    const next = addTrack(pool.items, ctx, tape, seen.current);
    if (next.length === tape.length) return toast({ title: "Nothing else fits", body: "Try more days, a wider range or a bigger budget.", emoji: "🎚️" });
    setTape(next);
    setN(next.length);
    spin();
  };

  // Space bar: shuffle (when not typing or on a control).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.closest("input, textarea, select, button, a, [contenteditable], [role=listbox]") || el.isContentEditable)) return;
      e.preventDefault();
      shuffle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Playing: one track after another on the map.
  useEffect(() => {
    if (playing == null) return;
    const t = window.setTimeout(() => {
      if (playing + 1 < tape.length) setPlaying(playing + 1);
      else {
        setPlaying(null);
        toast({ title: "That's the tape!", body: "Share it with whoever's coming along.", emoji: "🎧" });
      }
    }, PLAY_MS);
    return () => window.clearTimeout(t);
  }, [playing, tape.length]);
  useEffect(() => {
    if (playing == null) return;
    const row = document.getElementById(`mx-track-${playing}`);
    const r = row?.getBoundingClientRect();
    if (row && r && (r.top < 80 || r.bottom > window.innerHeight)) row.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [playing]);

  // The address always holds the current tape, so reloading or copying it keeps it.
  const query = city && win ? tapeQuery({ city: city.id, kind, fromDate: win.fromDate, toDate: win.toDate, vibe, name: customName.trim() || undefined, tracks: tape }) : "";
  useEffect(() => {
    if (!query || !tape.length) return;
    const t = window.setTimeout(() => window.history.replaceState(window.history.state, "", `/mixtape?${query}`), 400);
    return () => window.clearTimeout(t);
  }, [query, tape.length]);
  useEffect(() => setSaved(false), [query]);

  const shareUrl = () => `${window.location.origin}/mixtape?${query}`;
  const share = async () => {
    const url = shareUrl();
    const text = `${name}: ${tape.length} things to do in ${city?.name}`;
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: name, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", body: "Anyone with it can play (and remix) your tape.", emoji: "🔗" });
    } catch {
      // cancelled, or no clipboard: show the link to copy by hand
      window.prompt("Copy this link", url);
    }
  };
  const calendar = () => {
    if (!city) return;
    const ics = tapeIcs(
      name,
      tape.flatMap((t) => {
        const c = byId.get(t.id);
        return c ? [{ id: t.id, title: c.title, start: t.start, end: t.end, venue: c.venue, url: `${window.location.origin}/events/${c.slug}`, flex: t.flex }] : [];
      }),
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = `${name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "mixtape"}.ics`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast({ title: "Calendar file ready", body: "Open it to add every track to your calendar.", emoji: "🗓️" });
  };
  const save = () => {
    if (!city || !win || !tape.length) return;
    const entry: ShelfTape = { q: query, name, city: city.name, hue, tracks: tape.length, at: Date.now() };
    const list = [entry, ...readShelf().filter((x) => x.q !== query && x.name !== name)];
    writeShelf(list);
    setShelf(list.slice(0, 12));
    userActions.createTrip(name, win.fromDate, win.toDate, tape.map((t) => t.id));
    setSaved(true);
    toast({ title: "On your shelf", body: "Also saved as a trip in My World.", emoji: "📼", href: "/my-world", linkLabel: "Open My World" });
  };
  const fromShelf = (s: ShelfTape) => {
    const l = parseTapeQuery(new URLSearchParams(s.q));
    if (!l) return;
    seen.current = new Set();
    if (l.city === cityId && l.fromDate === win?.fromDate && pool) {
      // Same city and dates: no need to fetch again.
      setVibe(l.vibe);
      setCustomName(l.name ?? "");
      const got = l.tracks.filter((t) => byId.has(t.id) && t.end > Date.now());
      if (got.length) {
        setTape(got);
        setN(got.length);
        setShared(false);
        spin();
      }
    } else openLink(l, Date.now());
    window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
  };
  const unshelve = (q: string) => {
    const list = readShelf().filter((x) => x.q !== q);
    writeShelf(list);
    setShelf(list);
  };

  // ---- what the tape shows
  const tz = city?.tz ?? "UTC";
  const stats = useMemo(() => tapeStats(tape, byId, tz), [tape, byId, tz]);
  // The forecast for the tape's days (asked for by the browser).
  const wx = useForecast(city?.lat, city?.lng, 10);
  const fmt = (t: number, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...o }).format(new Date(t));
  const time = (t: number) => fmt(t, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const stops: RouteStop[] = tape.flatMap((t, i) => {
    const c = byId.get(t.id);
    return c ? [{ key: `${t.id}@${t.start}`, lat: c.lat, lng: c.lng, color: GROUP_HEX[c.group] ?? GROUP_HEX.other, title: c.title, newDay: i > 0 && tapeDay(t.start, tz) !== tapeDay(tape[i - 1].start, tz) }] : [];
  });
  const sides: { letter: string; label: string; date: string; items: { t: Track; i: number }[] }[] = [];
  tape.forEach((t, i) => {
    const d = tapeDay(t.start, tz);
    const last = sides[sides.length - 1];
    // After midnight it's still the evening before.
    const dayOf = t.start - (localMinutes(t.start, tz) < 300 ? 6 * 3600000 : 0);
    if (last && tapeDay(last.items[0].t.start, tz) === d) last.items.push({ t, i });
    else sides.push({ letter: String.fromCharCode(65 + sides.length), label: fmt(dayOf, { weekday: "long", day: "numeric", month: "short" }), date: todayIn(tz, new Date(dayOf)), items: [{ t, i }] });
  });
  const active = playing ?? pointed;
  const progress = playing != null && tape.length ? (playing + 1) / tape.length : Math.min(0.85, 0.15 + tape.length * 0.08);
  const sub = city && win ? `${city.name.toUpperCase()} · ${windowLabel(win, tz)}` : "Pick a city";
  const today = city ? todayIn(city.tz, new Date(now ?? 0)) : "";

  return (
    <main id="main" className="pb-24" style={{ "--tape-hue": hue } as CSSProperties}>
      <p className="sr-only" aria-live="polite">{announce}</p>
      {/* The deck: the tape, record and play */}
      <section className="mx-stage">
        <div className="mx-auto max-w-[1300px] px-4 sm:px-6 pt-8 pb-16 sm:pt-12 sm:pb-20 grid gap-8 lg:grid-cols-[1fr_minmax(0,500px)] items-center">
          <div className="relative z-10">
            <p className="mx-mark t-small">
              <Headphones size={15} aria-hidden /> OMNIEVENT Mixtape
            </p>
            <h1 className="t-display mt-3 text-white text-balance">
              Your weekend,
              <br />
              <span className="mx-text">on tape.</span>
            </h1>
            <p className="t-lede text-white/80 mt-4 measure">
              Pick a city and a vibe and we press record: real events, in order, with time to get from one to the next. Shuffle what you don&apos;t love, lock what you do, then share the tape.
            </p>
            <ol className="mx-steps mt-6">
              <li><span>1</span> Set the vibe</li>
              <li><span>2</span> Shuffle &amp; lock</li>
              <li><span>3</span> Play it, share it, go</li>
            </ol>
          </div>
          <div className="relative z-10">
            <Cassette name={customName} placeholder={autoName} onName={setCustomName} sub={sub} hue={hue} spinning={spinning || loading || playing != null} progress={progress} side={sides[0]?.letter ?? "A"} />
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              <button type="button" className="btn mx-btn-rec" onClick={shuffle} disabled={!pool || loading}>
                <Shuffle size={17} aria-hidden /> Shuffle
                <kbd className="kbd mx-kbd max-sm:hidden">Space</kbd>
              </button>
              <button type="button" className="btn mx-btn-play" onClick={() => setPlaying(playing == null ? 0 : null)} disabled={!tape.length} aria-pressed={playing != null}>
                {playing == null ? <Play size={17} aria-hidden /> : <Square size={15} aria-hidden />} {playing == null ? "Play the tape" : "Stop"}
              </button>
            </div>
            <p className="mx-now t-small" aria-live="polite">
              {playing != null && byId.get(tape[playing]?.id) ? (
                <>
                  <span className="mx-now-dot" aria-hidden /> Now playing · {pad(playing + 1)} · {byId.get(tape[playing].id)!.title}
                </>
              ) : loading ? (
                "Recording…"
              ) : tape.length ? (
                `${tape.length} track${tape.length === 1 ? "" : "s"} · ${duration(stats.minutes)} of events`
              ) : (
                " "
              )}
            </p>
          </div>
        </div>
      </section>

      {/* The mixing desk */}
      <section className="mx-auto max-w-[1300px] px-4 sm:px-6 -mt-10 relative z-10">
        <div className="mx-desk">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            <div className="grid gap-4 content-start">
              <CityPicker cities={cities} value={city} onPick={(c) => {
                setCityId(c.id);
                setShared(false);
                setTape([]);
                setN(null);
              }} />
              <div>
                <p className="mx-label">When</p>
                <div className="flex flex-wrap gap-1.5 mt-2" role="group" aria-label="When">
                  {WHEN.map((w) => (
                    <button key={w.id} type="button" className="chip" aria-pressed={kind === w.id} onClick={() => {
                      setKind(w.id);
                      setN(null);
                      setShared(false);
                      if (w.id === "dates" && !dates.from && today) setDates({ from: today, to: addDays(today, 1) });
                    }}>
                      {w.label}
                    </button>
                  ))}
                </div>
                {kind === "dates" && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label className="grid gap-1 t-micro text-text-3">
                      From
                      <input type="date" className="field !h-10" value={dates.from || today} min={today} onChange={(e) => {
                        const from = e.target.value;
                        setDates((d) => ({ from, to: !d.to || d.to < from ? from : d.to }));
                        setN(null);
                      }} />
                    </label>
                    <label className="grid gap-1 t-micro text-text-3">
                      To
                      <input type="date" className="field !h-10" value={dates.to || dates.from || today} min={dates.from || today} max={dates.from ? addDays(dates.from, 6) : undefined} onChange={(e) => {
                        setDates((d) => ({ ...d, to: e.target.value }));
                        setN(null);
                      }} />
                    </label>
                  </div>
                )}
                {win && <p className="t-micro text-text-3 mt-2">{windowLabel(win, tz)} · times in {city?.name}</p>}
              </div>
            </div>
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Fader label="Energy" value={vibe.energy} max={4} onChange={(v) => setVibe({ ...vibe, energy: v })} text={`${ENERGY[vibe.energy].emoji} ${ENERGY[vibe.energy].label}`} ends={["Slow", "Loud"]} />
                <Fader
                  label="Budget"
                  value={vibe.budget}
                  max={3}
                  onChange={(v) => setVibe({ ...vibe, budget: v })}
                  text={`${BUDGET[vibe.budget].emoji} ${BUDGET[vibe.budget].label}${vibe.budget === 1 || vibe.budget === 2 ? ` (≤ ${money(Math.round(caps[vibe.budget]))})` : ""}`}
                  ends={["Free", "Treat"]}
                />
                <Fader label="Getting around" value={vibe.range} max={2} onChange={(v) => setVibe({ ...vibe, range: v })} text={`${RANGE[vibe.range].emoji} ${RANGE[vibe.range].label}`} ends={["Walk", "Whole city"]} />
              </div>
              <div>
                <p className="mx-label">Moods <span className="font-normal normal-case tracking-normal text-text-3">· none picked means anything goes</span></p>
                <div className="flex flex-wrap gap-1.5 mt-2" role="group" aria-label="Moods">
                  {MOODS.map((m) => {
                    const on = vibe.moods.includes(m.id);
                    return (
                      <button key={m.id} type="button" className="chip" aria-pressed={on} onClick={() => setVibe({ ...vibe, moods: on ? vibe.moods.filter((x) => x !== m.id) : [...vibe.moods, m.id] })}>
                        <span aria-hidden>{m.emoji}</span> {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <p className="mx-label">Tracks</p>
                <div className="mx-stepper">
                  <button type="button" aria-label="One track fewer" onClick={() => setCount(target - 1)} disabled={target <= 1}>
                    <Minus size={15} aria-hidden />
                  </button>
                  <output aria-live="polite" className="tnum">{target}</output>
                  <button type="button" aria-label="One more track" onClick={() => setCount(target + 1)} disabled={target >= MAX_TRACKS}>
                    <Plus size={15} aria-hidden />
                  </button>
                </div>
                {pool && <p className="t-micro text-text-3">from {pool.total.toLocaleString("en-GB")} events on in {city?.name} then</p>}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The tracklist and the map */}
      <section className="mx-auto max-w-[1300px] px-4 sm:px-6 mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.82fr)] items-start">
        <div className="min-w-0">
          {shared && tape.length > 0 && (
            <div className="mx-banner">
              <span aria-hidden>🎧</span>
              <p>
                <strong>A tape shared with you.</strong> Lock the tracks you like and shuffle the rest to make it yours.
              </p>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Dismiss" onClick={() => setShared(false)}>
                <X size={15} aria-hidden />
              </button>
            </div>
          )}
          {error ? (
            <div className="mx-empty">
              <p className="t-h3">The tape got stuck</p>
              <p className="t-small text-text-2 mt-1">{error}</p>
              <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </button>
            </div>
          ) : !pool || loading ? (
            <ol className="grid gap-3" aria-label="Recording your tape">
              {Array.from({ length: Math.min(target, 5) }, (_, i) => (
                <li key={i} className="mx-skeleton" style={{ animationDelay: `${i * 90}ms` }} />
              ))}
            </ol>
          ) : !tape.length ? (
            <div className="mx-empty">
              <p className="t-h3">Nothing to record yet</p>
              <p className="t-small text-text-2 mt-1">
                {pool.total ? "No events fit this vibe then. Try another mood, a bigger budget or a wider range." : `We don't have events in ${city?.name} for these dates yet. Try another city or other dates.`}
              </p>
              {vibe.moods.length > 0 || vibe.budget < 2 || vibe.range < 2 ? (
                <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => setVibe({ ...vibe, moods: [], budget: Math.max(vibe.budget, 2), range: 2 })}>
                  Loosen the vibe
                </button>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-5">
              {sides.map((s) => (
                <section key={s.letter} aria-label={`Side ${s.letter}: ${s.label}`}>
                  <h2 className="mx-side">
                    <span className="mx-side-letter">{s.letter}</span>
                    <span>Side {s.letter}</span>
                    <span className="text-text-3 font-medium">· {s.label}</span>
                    {(() => {
                      const w = wx?.days.find((x) => x.date === s.date);
                      if (!w) return null;
                      const look = weatherLook(w.code);
                      return (
                        <span className="mx-wx" title={`${look.label}${w.rain != null ? `, ${w.rain}% chance of rain` : ""}`}>
                          <span aria-hidden>{look.emoji}</span> {w.max}°<span className="sr-only">, {look.label}</span>
                          {w.rain != null && w.rain >= 50 && <span className="mx-wx-rain">☂ {w.rain}%</span>}
                        </span>
                      );
                    })()}
                  </h2>
                  <ol className="mt-2.5">
                    {s.items.map(({ t, i }, k) => {
                      const c = byId.get(t.id);
                      if (!c) return null;
                      const prev = k > 0 ? s.items[k - 1].t : null;
                      const pc = prev ? byId.get(prev.id) : undefined;
                      const h = pc ? hop(pc, c) : null;
                      const gap = prev && h ? gapNote(prev.end + h.minutes * 60000, t.start, tz) : null;
                      const block = t.flex ? c.open?.find(([o, cl]) => t.start >= o && t.start < cl) : undefined;
                      const price = c.free || c.price === 0 ? "Free" : c.price != null ? money(c.price) : null;
                      return (
                        <li key={`${t.id}@${t.start}`}>
                          {h && (
                            <div className="mx-hop t-micro">
                              <span className="mx-hop-line" aria-hidden />
                              <span>
                                {h.mode === "walk" ? "🚶" : "🚕"} {h.mode === "walk" ? `${h.minutes} min walk` : `~${h.minutes} min ride`} · {km(h.km)}
                                {gap ? <span className="text-text-3"> · {gap}</span> : null}
                              </span>
                            </div>
                          )}
                          <div
                            id={`mx-track-${i}`}
                            className="mx-track"
                            data-locked={t.locked || undefined}
                            data-active={active === i || undefined}
                            style={{ "--accent": GROUP_HEX[c.group] ?? GROUP_HEX.other, animationDelay: `${Math.min(k, 6) * 70}ms` } as CSSProperties}
                            onMouseEnter={() => setPointed(i)}
                            onMouseLeave={() => setPointed((p) => (p === i ? null : p))}
                          >
                            <span className="mx-track-num tnum" aria-hidden>{pad(i + 1)}</span>
                            <Poster title={c.title} imageUrl={c.img} hue={c.hue} categorySlug={c.cat} size="sm" className="mx-track-img" />
                            <div className="min-w-0">
                              <p className="mx-track-when tnum">
                                {t.flex ? (
                                  <>
                                    Drop in · ~{time(t.start)}
                                    {block && !c.loose ? <span className="text-text-3 font-normal"> · open {time(block[0])}–{time(block[1])}</span> : null}
                                  </>
                                ) : (
                                  <>
                                    {time(t.start)}
                                    <span className="text-text-3 font-normal"> – {time(t.end)}</span>
                                  </>
                                )}
                              </p>
                              <Link href={`/events/${c.slug}`} className="mx-track-title">
                                {c.title}
                              </Link>
                              <p className="mx-track-meta t-small">
                                <CategoryIcon slug={c.cat} size={13} />
                                <span className="truncate">
                                  {getCategory(c.cat)?.name ?? getCategory(c.group)?.name} · {c.venue}
                                </span>
                              </p>
                              {c.loose ? (
                                <p className="t-micro text-warn mt-0.5">Times not announced: check before you go</p>
                              ) : c.until && t.flex ? (
                                <p className="t-micro text-text-3 mt-0.5">On until {fmt(c.until, { day: "numeric", month: "short" })}: check it&apos;s open that day</p>
                              ) : null}
                            </div>
                            <div className="mx-track-side">
                              {price && <span className={`mx-price ${price === "Free" ? "is-free" : ""}`}>{price}</span>}
                              <div className="mx-track-actions">
                                <TripButton id={t.id} title={c.title} variant="bare" className="mx-icon" />
                                <button type="button" className="mx-icon" aria-pressed={!!t.locked} aria-label={t.locked ? `Unlock ${c.title}` : `Lock ${c.title}: keep it when shuffling`} title={t.locked ? "Unlock" : "Lock: keep it when shuffling"} onClick={() => toggleLock(i)}>
                                  {t.locked ? <Lock size={15} aria-hidden /> : <LockOpen size={15} aria-hidden />}
                                </button>
                                <button type="button" className="mx-icon" aria-label={`Swap ${c.title} for something else`} title="Swap for something else" onClick={() => reroll(i)} disabled={!!t.locked}>
                                  <Dices size={15} aria-hidden />
                                </button>
                                <button type="button" className="mx-icon" aria-label={`Remove ${c.title}`} title="Remove" onClick={() => remove(i)}>
                                  <X size={15} aria-hidden />
                                </button>
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
              <button type="button" className="mx-add" onClick={add} disabled={tape.length >= MAX_TRACKS}>
                <Plus size={16} aria-hidden /> Add a track
              </button>
              <div className="mx-summary">
                <div>
                  <p className="mx-stat tnum">{stats.tracks}</p>
                  <p className="t-micro text-text-3">tracks</p>
                </div>
                <div>
                  <p className="mx-stat tnum">{duration(stats.minutes)}</p>
                  <p className="t-micro text-text-3">of events</p>
                </div>
                <div>
                  <p className="mx-stat tnum">{stats.free === stats.tracks ? "Free" : stats.cost ? `≈ ${money(stats.cost)}` : "—"}</p>
                  <p className="t-micro text-text-3">{stats.free === stats.tracks ? "every track" : `per person${stats.unpriced ? ` · ${stats.unpriced} without a price` : ""}`}</p>
                </div>
                <div>
                  <p className="mx-stat tnum">{km(stats.km)}</p>
                  <p className="t-micro text-text-3">getting around</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <button type="button" className="btn btn-primary" onClick={share}>
                  <Share2 size={16} aria-hidden /> Share the tape
                </button>
                <button type="button" className="btn btn-secondary" onClick={calendar}>
                  <CalendarPlus size={16} aria-hidden /> Add to calendar
                </button>
                <button type="button" className="btn btn-secondary" onClick={save} disabled={saved}>
                  {saved ? <Check size={16} aria-hidden /> : <BookmarkPlus size={16} aria-hidden />} {saved ? "Saved" : "Save tape"}
                </button>
              </div>
              <p className="t-micro text-text-3">Times and prices come from each event&apos;s source; check the event page before you go. Travel times are estimates.</p>
            </div>
          )}
        </div>
        <div className="mx-map lg:sticky lg:top-[calc(var(--header-h)+16px)]">
          {city && <RouteMap stops={stops} active={active} follow={playing != null} centre={{ lat: city.lat, lng: city.lng }} onPick={(i) => document.getElementById(`mx-track-${i}`)?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" })} />}
        </div>
      </section>

      {/* The shelf */}
      {shelf.length > 0 && (
        <section className="mx-auto max-w-[1300px] px-4 sm:px-6 mt-12">
          <h2 className="t-h2">Your shelf</h2>
          <p className="t-small text-text-2 mt-1">Tapes you saved on this device.</p>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {shelf.map((s) => (
              <li key={s.q} className="mx-spine" style={{ "--tape-hue": s.hue } as CSSProperties}>
                <button type="button" className="mx-spine-main" onClick={() => fromShelf(s)}>
                  <span className="mx-spine-reels" aria-hidden />
                  <span className="min-w-0">
                    <span className="block font-semibold truncate">{s.name}</span>
                    <span className="block t-micro opacity-80">
                      {s.city} · {s.tracks} track{s.tracks === 1 ? "" : "s"}
                    </span>
                  </span>
                </button>
                <button type="button" className="mx-icon mx-spine-x" aria-label={`Remove ${s.name} from your shelf`} onClick={() => unshelve(s.q)}>
                  <Trash2 size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/** A labelled slider with named steps. */
function Fader({ label, value, max, onChange, text, ends }: { label: string; value: number; max: number; onChange: (v: number) => void; text: string; ends: [string, string] }) {
  return (
    <label className="mx-fader">
      <span className="mx-label">{label}</span>
      <span className="mx-fader-value">{text}</span>
      <input type="range" min={0} max={max} step={1} value={value} aria-valuetext={text} onChange={(e) => onChange(Number(e.target.value))} style={{ "--fill": `${(value / max) * 100}%` } as CSSProperties} />
      <span className="mx-fader-ends t-micro" aria-hidden>
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </span>
    </label>
  );
}

/** Which city: type to find one among those with events. */
function CityPicker({ cities, value, onPick }: { cities: MixCity[]; value?: MixCity; onPick: (c: MixCity) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const strip = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const list = useMemo(() => {
    const t = strip(q.trim());
    return (t ? cities.filter((c) => strip(c.name).includes(t) || strip(c.country).startsWith(t)).sort((a, b) => Number(!strip(a.name).startsWith(t)) - Number(!strip(b.name).startsWith(t)) || b.n - a.n) : cities).slice(0, 8);
  }, [cities, q]);
  const choose = (c: MixCity) => {
    onPick(c);
    setOpen(false);
    setQ("");
  };
  return (
    <div className="relative">
      <p className="mx-label" id="mx-city-label">City</p>
      {!open ? (
        <button type="button" className="mx-city mt-2" aria-labelledby="mx-city-label mx-city-now" onClick={() => setOpen(true)}>
          <span id="mx-city-now" className="min-w-0 truncate">
            {value ? (
              <>
                <strong>{value.name}</strong>
                <span className="text-text-3">, {value.country}</span>
              </>
            ) : (
              "Choose a city"
            )}
          </span>
          <ChevronDown size={17} aria-hidden className="shrink-0 text-text-3" />
        </button>
      ) : (
        <div className="relative mt-2">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3" aria-hidden />
          <input
            ref={input}
            // Opened on purpose by the person choosing a city: typing starts straight away.
            autoFocus
            className="field w-full !pl-10 !h-12"
            placeholder="Type a city"
            value={q}
            role="combobox"
            aria-expanded
            aria-controls="mx-city-list"
            aria-labelledby="mx-city-label"
            aria-activedescendant={list[active] ? `mx-city-${list[active].id}` : undefined}
            autoComplete="off"
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Escape") return setOpen(false);
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(list.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter" && list[active]) {
                e.preventDefault();
                choose(list[active]);
              }
            }}
          />
          <ul id="mx-city-list" role="listbox" className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-[var(--radius-m)] border border-line bg-panel shadow-xl panel-in">
            {list.length ? (
              list.map((c, i) => (
                <li key={c.id} id={`mx-city-${c.id}`} role="option" aria-selected={i === active} className={`flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 ${i === active ? "bg-cyan/10" : "hover:bg-panel-2"}`} onMouseDown={(e) => (e.preventDefault(), choose(c))}>
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-text-3">, {c.country}</span>
                  </span>
                  <span className="t-micro text-text-3 tnum shrink-0">{c.n.toLocaleString("en-GB")} events</span>
                </li>
              ))
            ) : (
              <li className="px-3.5 py-3 t-small text-text-3">No city by that name has events yet.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
