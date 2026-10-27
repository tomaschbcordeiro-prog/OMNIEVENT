"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { SearchFilters } from "@/lib/types";
import { datePresets } from "../discover/filters";

/**
 * The globe's time machine: when to look (on right now, today, tomorrow, this weekend, the
 * next week or month, any time), and a play button that walks the globe through the next
 * seven days, one day every couple of seconds, so you can watch the planet's week fill up.
 */

const STEP_MS = 2600;
const DAYS = 7;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The next `n` days from today (local calendar), as YYYY-MM-DD. */
function nextDays(n: number): string[] {
  const t = new Date();
  const today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  return Array.from({ length: n }, (_, i) => ymd(new Date(today + i * 86400000)));
}

const dayLabel = (d: string, i: number) =>
  i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
const dateLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

export function TimeBar({
  filters,
  onChange,
  live,
  count,
  loading,
  reduced,
}: {
  filters: SearchFilters;
  onChange: (patch: Partial<SearchFilters>) => void;
  /** Events on right now in view (matching the other filters). */
  live: number;
  /** Events in view for the current choice. */
  count: number | null;
  loading: boolean;
  reduced: boolean;
}) {
  const [step, setStep] = useState<number | null>(null);
  const days = useRef<string[]>([]);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  // Play: one day at a time, then settle on the whole week.
  useEffect(() => {
    if (step === null) return;
    const d = days.current[step];
    changeRef.current({ live: undefined, from: d, to: d });
    const t = setTimeout(() => {
      if (step + 1 < days.current.length) setStep(step + 1);
      else {
        setStep(null);
        changeRef.current({ live: undefined, from: days.current[0], to: days.current[days.current.length - 1] });
      }
    }, reduced ? STEP_MS * 1.5 : STEP_MS);
    return () => clearTimeout(t);
  }, [step, reduced]);

  const presets = datePresets();
  const tomorrow = nextDays(2)[1];
  const items: { id: string; label: string; from?: string; to?: string; live?: boolean }[] = [
    { id: "live", label: "Live now", live: true },
    { id: "today", label: "Today", from: presets[0].from, to: presets[0].to },
    { id: "tomorrow", label: "Tomorrow", from: tomorrow, to: tomorrow },
    { id: "weekend", label: "Weekend", from: presets[1].from, to: presets[1].to },
    { id: "week", label: "7 days", from: presets[2].from, to: presets[2].to },
    { id: "month", label: "30 days", from: presets[3].from, to: presets[3].to },
    { id: "any", label: "Any time" },
  ];
  const playing = step !== null;
  const active = playing
    ? null
    : filters.live
      ? "live"
      : items.find((i) => !i.live && i.from === filters.from && i.to === filters.to)?.id ?? null;

  const pick = (i: (typeof items)[number]) => {
    setStep(null);
    onChange(i.live ? { live: true, from: undefined, to: undefined } : { live: undefined, from: i.from, to: i.to });
  };
  const toggle = () => {
    if (playing) return setStep(null);
    days.current = nextDays(DAYS);
    setStep(0);
  };

  return (
    <>
      <div className="surface-float rounded-full p-1 flex items-center gap-0.5 max-w-[calc(100vw-2rem)] overflow-x-auto no-scrollbar" role="group" aria-label="When">
        <button
          type="button"
          onClick={toggle}
          aria-pressed={playing}
          aria-label={playing ? "Stop playing the week" : "Play the next 7 days on the globe, one day at a time"}
          title={playing ? "Stop" : "Play the week"}
          className={`shrink-0 grid place-items-center h-8 w-8 rounded-full transition-colors ${playing ? "bg-cyan text-white" : "bg-text text-white hover:bg-cyan"}`}
        >
          {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden className="translate-x-[1px]" />}
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
                on ? (i.live ? "bg-live text-white" : "bg-text text-white") : "text-text-2 hover:text-text hover:bg-panel-2"
              }`}
            >
              {i.live && <span className={`live-dot ${on ? "live-dot--on" : ""}`} aria-hidden />}
              {i.label}
              {i.live && live > 0 && !on && <span className="tnum text-live">{live.toLocaleString()}</span>}
            </button>
          );
        })}
      </div>
      {playing && (
        <div className="fixed z-20 left-1/2 -translate-x-1/2 top-[max(58%,30rem)] pointer-events-none text-center rounded-[20px] bg-[rgb(8_20_52_/_0.5)] backdrop-blur-md px-6 py-3.5 shadow-[0_18px_40px_-18px_rgb(0_0_0_/_0.6)]" aria-live="polite">
          <div key={step} className="time-flip text-white">
            <p className="text-[2rem] sm:text-[2.75rem] font-bold leading-none tracking-tight">{dayLabel(days.current[step], step)}</p>
            <p className="mt-1.5 text-[14px] sm:text-[16px] font-medium text-white/85 whitespace-nowrap">
              {dateLabel(days.current[step])}
              {count != null && !loading ? <> · <span className="tnum">{count.toLocaleString()}</span> events in view</> : null}
            </p>
          </div>
          <div className="mt-2.5 flex justify-center gap-1.5" aria-hidden>
            {days.current.map((d, i) => (
              <span key={d} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? "w-6 bg-white" : i < step ? "w-1.5 bg-white/80" : "w-1.5 bg-white/35"}`} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
