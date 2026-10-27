"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, X } from "lucide-react";
import type { SearchFilters } from "@/lib/types";
import { datePresets } from "../discover/filters";

/**
 * The globe's time machine.
 *
 * Folded: quick choices (on right now, today, tomorrow, this weekend, the next week or month,
 * any time); tapping the active one again turns it off.
 *
 * Unfolded: a two-week timeline. Each day's bar shows how many events the visible part of the
 * planet has that day; tap or drag along it to travel in time, or press play to watch the
 * days go by. The globe shows each day's events as soon as it has them: the days ahead are
 * fetched in advance, and play only moves on once the current day is on screen.
 */

const DAYS = 14;
/** How long play stays on a day once its events are showing. */
const DWELL_MS = 1300;
/** Play moves on anyway if a day takes this long to load. */
const MAX_WAIT_MS = 7000;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The next `n` days from today (local calendar), as YYYY-MM-DD. */
function nextDays(n: number): string[] {
  const t = new Date();
  const today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  return Array.from({ length: n }, (_, i) => ymd(new Date(today + i * 86400000)));
}

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const dayName = (d: string, i: number) => (i === 0 ? "Today" : i === 1 ? "Tomorrow" : fmt(d, { weekday: "long" }));
const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());

export function TimeBar({
  filters,
  onChange,
  live,
  count,
  ready,
  baseQuery,
  viewQuery,
  prefetch,
  reduced,
}: {
  filters: SearchFilters;
  onChange: (patch: Partial<SearchFilters>) => void;
  /** Events on right now in view (matching the other filters). */
  live: number;
  /** Events in view for the current choice, once loaded. */
  count: number | null;
  /** The globe is showing the events for the current filters. */
  ready: boolean;
  /** The filters other than dates, as URL parameters. */
  baseQuery: string;
  /** The visible area as URL parameters ("" for the whole planet). */
  viewQuery: string;
  /** Warm the globe's events for these days in the current view. */
  prefetch: (days: string[]) => void;
  reduced: boolean;
}) {
  const [days, setDays] = useState<string[] | null>(null);
  const [sel, setSel] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [counts, setCounts] = useState<number[] | null>(null);
  const saved = useRef<Partial<SearchFilters>>({});
  const track = useRef<HTMLDivElement>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const open = days !== null;

  // ---- folded: quick choices
  const presets = datePresets();
  const tomorrow = nextDays(2)[1];
  const items: { id: string; label: string; from?: string; to?: string; live?: boolean }[] = [
    { id: "live", label: "Live now", live: true },
    { id: "today", label: "Today", from: presets[0].from, to: presets[0].to },
    { id: "tomorrow", label: "Tomorrow", from: tomorrow, to: tomorrow },
    { id: "weekend", label: "Weekend", from: presets[1].from, to: presets[1].to },
    { id: "week", label: "7 days", from: presets[2].from, to: presets[2].to },
    { id: "month", label: "30 days", from: presets[3].from, to: presets[3].to },
  ];
  const active = filters.live ? "live" : items.find((i) => !i.live && i.from === filters.from && i.to === filters.to)?.id ?? (!filters.from && !filters.to ? "any" : null);
  const pick = (i: (typeof items)[number]) => {
    // The active choice again: back to any time.
    if (active === i.id) return onChange({ live: undefined, from: undefined, to: undefined });
    onChange(i.live ? { live: true, from: undefined, to: undefined } : { live: undefined, from: i.from, to: i.to });
  };

  // ---- unfolded: the timeline
  const go = (i: number) => {
    if (!days) return;
    const k = Math.max(0, Math.min(days.length - 1, i));
    setSel(k);
    changeRef.current({ live: undefined, from: days[k], to: days[k] });
  };
  const openTimeline = (play: boolean) => {
    const d = nextDays(DAYS);
    saved.current = { live: filters.live, from: filters.from, to: filters.to };
    const at = filters.from && filters.from === filters.to ? Math.max(0, d.indexOf(filters.from)) : 0;
    setDays(d);
    setSel(at);
    setPlaying(play);
    changeRef.current({ live: undefined, from: d[at], to: d[at] });
  };
  const close = () => {
    setPlaying(false);
    setDays(null);
    setCounts(null);
    changeRef.current(saved.current);
  };

  // Each day's count for the visible area (one small request).
  useEffect(() => {
    if (!days) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const q = [baseQuery, viewQuery, `start=${days[0]}&n=${days.length}`].filter(Boolean).join("&");
      fetch(`/api/geo/days?${q}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: { counts: number[] }) => setCounts(j.counts))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [days, baseQuery, viewQuery]);

  // The globe's events for every day, from the selected one onwards, fetched ahead.
  const prefetchRef = useRef(prefetch);
  prefetchRef.current = prefetch;
  useEffect(() => {
    if (!days) return;
    const t = setTimeout(() => prefetchRef.current([...days.slice(sel), ...days.slice(0, sel)]), 300);
    return () => clearTimeout(t);
    // Only when the area or the other filters change, not on every step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, baseQuery, viewQuery]);

  // Play: stay on each day a moment once its events are on the globe, then move on.
  const readyRef = useRef(ready);
  readyRef.current = ready;
  useEffect(() => {
    if (!playing || !days || scrubbing) return;
    const started = performance.now();
    let shownAt = 0;
    const iv = setInterval(() => {
      const now = performance.now();
      if (readyRef.current && !shownAt) shownAt = now;
      if ((shownAt && now - shownAt >= (reduced ? DWELL_MS * 1.6 : DWELL_MS)) || now - started > MAX_WAIT_MS) {
        clearInterval(iv);
        if (sel + 1 < days.length) go(sel + 1);
        else setPlaying(false);
      }
    }, 100);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, sel, days, scrubbing, reduced]);

  const indexAt = (x: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || !days) return sel;
    return Math.floor(((x - r.left) / r.width) * days.length);
  };
  const max = counts ? Math.max(1, ...counts) : 1;
  const shown = open ? (counts?.[sel] ?? (ready ? count : null)) : null;

  if (!open)
    return (
      <div className="surface-float rounded-full p-1 flex items-center gap-0.5 max-w-[calc(100vw-2rem)] overflow-x-auto no-scrollbar" role="group" aria-label="When">
        <button
          type="button"
          onClick={() => openTimeline(true)}
          aria-label="Open the timeline and play the next two weeks on the globe"
          title="Travel in time"
          className="shrink-0 inline-flex items-center gap-1.5 h-8 rounded-full pl-2.5 pr-3 bg-text text-white hover:bg-cyan transition-colors text-[13px] font-semibold"
        >
          <Play size={13} aria-hidden className="translate-x-[1px]" /> Timeline
        </button>
        {items.map((i) => {
          const on = active === i.id;
          return (
            <button
              key={i.id}
              type="button"
              aria-pressed={on}
              onClick={() => pick(i)}
              className={`shrink-0 inline-flex items-center gap-1.5 h-8 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                on ? (i.live ? "bg-live text-white" : "bg-cyan text-white") : "text-text-2 hover:text-text hover:bg-panel-2"
              }`}
            >
              {i.live && <span className={`live-dot ${on ? "live-dot--on" : ""}`} aria-hidden />}
              {i.label}
              {i.live && live > 0 && !on && <span className="tnum text-live">{live.toLocaleString()}</span>}
              {on && <X size={12} aria-hidden className="-mr-1 opacity-80" />}
            </button>
          );
        })}
      </div>
    );

  return (
    <>
      <div className="surface-float rounded-[18px] p-2.5 w-[min(560px,calc(100vw-2rem))] panel-in" role="group" aria-label="Timeline">
        <div className="flex items-center gap-2.5 px-0.5">
          <button
            type="button"
            onClick={() => {
              if (playing) return setPlaying(false);
              // From the end, play starts again from today.
              if (sel === days.length - 1) go(0);
              setPlaying(true);
            }}
            aria-label={playing ? "Pause" : "Play the days one by one"}
            className={`shrink-0 grid place-items-center h-9 w-9 rounded-full text-white transition-colors ${playing ? "bg-cyan" : "bg-text hover:bg-cyan"}`}
          >
            {playing ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden className="translate-x-[1px]" />}
          </button>
          <div className="min-w-0 flex-1" aria-live="polite">
            <p className="text-[15px] font-semibold leading-tight truncate">
              {dayName(days[sel], sel)} <span className="text-text-3 font-medium">{fmt(days[sel], { day: "numeric", month: "short" })}</span>
            </p>
            <p className="t-micro text-text-3 tnum truncate">
              {shown != null ? `${shown.toLocaleString()} events in view` : "Counting events…"}
              <span className="hidden sm:inline"> · drag along the days to travel in time</span>
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close the timeline" className="btn btn-ghost btn-icon btn-sm shrink-0">
            <X size={16} aria-hidden />
          </button>
        </div>
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label="Day"
          aria-valuemin={0}
          aria-valuemax={days.length - 1}
          aria-valuenow={sel}
          aria-valuetext={`${dayName(days[sel], sel)} ${fmt(days[sel], { day: "numeric", month: "long" })}${shown != null ? `, ${shown} events` : ""}`}
          className="mt-2 flex gap-[3px] touch-none select-none cursor-pointer rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setScrubbing(true);
            setPlaying(false);
            const i = indexAt(e.clientX);
            if (i !== sel) go(i);
          }}
          onPointerMove={(e) => {
            if (!scrubbing) return;
            const i = Math.max(0, Math.min(days.length - 1, indexAt(e.clientX)));
            if (i !== sel) go(i);
          }}
          onPointerUp={() => setScrubbing(false)}
          onPointerCancel={() => setScrubbing(false)}
          onKeyDown={(e) => {
            const k = { ArrowRight: sel + 1, ArrowLeft: sel - 1, Home: 0, End: days.length - 1 }[e.key];
            if (k !== undefined) {
              e.preventDefault();
              setPlaying(false);
              go(k);
            } else if (e.key === " ") {
              e.preventDefault();
              setPlaying((p) => !p);
            }
          }}
        >
          {days.map((d, i) => {
            const n = counts?.[i];
            const h = n == null ? 10 : 4 + 38 * (n / max);
            const on = i === sel;
            return (
              <div key={d} className="flex-1 min-w-0 flex flex-col items-center" title={`${fmt(d, { weekday: "short", day: "numeric", month: "short" })}${n != null ? `: ${n.toLocaleString()} events` : ""}`}>
                <div className="h-[42px] w-full flex items-end">
                  <div
                    className={`w-full rounded-t-[5px] rounded-b-[2px] transition-[height,background-color] duration-300 ${n == null ? "skeleton" : on ? "bg-cyan" : i < sel ? "bg-cyan/35" : isWeekend(d) ? "bg-violet/35" : "bg-text/15"}`}
                    style={{ height: h }}
                  />
                </div>
                <span className={`mt-1 text-[10px] leading-none font-semibold ${on ? "text-cyan" : isWeekend(d) ? "text-violet" : "text-text-3"}`}>{fmt(d, { weekday: "narrow" })}</span>
                <span className={`mt-0.5 text-[11px] leading-none tnum ${on ? "text-text font-bold" : "text-text-2"}`}>{fmt(d, { day: "numeric" })}</span>
              </div>
            );
          })}
        </div>
      </div>
      {(playing || scrubbing) && (
        <div className="fixed z-20 left-1/2 -translate-x-1/2 top-[max(58%,30rem)] pointer-events-none text-center rounded-[20px] bg-[rgb(8_20_52_/_0.5)] backdrop-blur-md px-6 py-3.5 shadow-[0_18px_40px_-18px_rgb(0_0_0_/_0.6)]">
          <div key={sel} className="time-flip text-white">
            <p className="text-[2rem] sm:text-[2.75rem] font-bold leading-none tracking-tight">{dayName(days[sel], sel)}</p>
            <p className="mt-1.5 text-[14px] sm:text-[16px] font-medium text-white/85 whitespace-nowrap">
              {fmt(days[sel], { day: "numeric", month: "long" })}
              {shown != null ? <> · <span className="tnum">{shown.toLocaleString()}</span> events</> : null}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
