"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, nightsBetween } from "@/lib/trip";

/*
 * A trip's dates on a calendar of our own (the phone's date fields write 12/10/2026 and hide the
 * trip's shape): tap the day you arrive, then the day you leave, and the days in between fill in.
 * On a computer, the range previews under the mouse before the second tap. Arrow keys move day by
 * day (and week by week), Enter picks.
 */

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** The quick lengths, once the first day is picked. */
const LENGTHS = [
  { label: "Long weekend", nights: 3 },
  { label: "A week", nights: 7 },
  { label: "10 days", nights: 10 },
  { label: "Two weeks", nights: 14 },
];
/** The longest trip the calendar picks. */
export const MAX_TRIP_NIGHTS = 90;

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const monthOf = (d: string) => d.slice(0, 7);
function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
/** The month's days in weeks from Monday (blanks before the 1st). */
function monthGrid(ym: string): (string | null)[] {
  const [y, m] = ym.split("-").map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [...Array<null>(lead).fill(null), ...Array.from({ length: len }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`)];
}
/** "Thu 10 Dec". */
export const shortDay = (d: string) => fmt(d, { weekday: "short", day: "numeric", month: "short" });

export function RangeCalendar({ start, end, min, onChange }: { start: string; end: string; min: string; onChange: (start: string, end: string) => void }) {
  /** The first day tapped, waiting for the second. */
  const [first, setFirst] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [month, setMonth] = useState(monthOf(start || min));
  const grid = useRef<HTMLDivElement>(null);
  const focusDay = useRef<string | null>(null);
  const today = min;
  const lo = first ?? start;
  const hi = first ? (hover && hover > first ? hover : "") : end;
  const max = first ? addDays(first, MAX_TRIP_NIGHTS) : "";

  const pick = (d: string) => {
    if (!first || d <= first) {
      setFirst(d);
      return;
    }
    setFirst(null);
    setHover(null);
    onChange(first, d);
  };
  const length = (n: number) => {
    const s = first ?? start;
    if (!s) return;
    setFirst(null);
    onChange(s, addDays(s, n));
  };

  // A day reached with the arrow keys in another month: that month shows, then the day gets focus.
  useEffect(() => {
    if (!focusDay.current) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay.current}"]`)?.focus();
    focusDay.current = null;
  }, [month]);
  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    const at = (e.target as HTMLElement).dataset.day;
    if (!step || !at) return;
    e.preventDefault();
    const next = addDays(at, step);
    if (next < min) return;
    if (monthOf(next) !== month) {
      focusDay.current = next;
      setMonth(monthOf(next));
    } else grid.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus();
  };

  const days = monthGrid(month);
  // One day in the month can be reached with Tab; the arrows do the rest.
  const tabDay = [lo, end, today].find((d) => d && monthOf(d) === month && d >= min) ?? days.find((d): d is string => !!d && d >= min);
  const hint = first ? "Now tap the day you leave" : start && end ? `${shortDay(start)} → ${shortDay(end)}` : "Tap the day you arrive";

  return (
    <div className="rc">
      <div className="rc-head">
        <button type="button" className="rc-nav" onClick={() => setMonth((m) => shiftMonth(m, -1))} disabled={month <= monthOf(min)} aria-label="Previous month">
          <ChevronLeft size={18} aria-hidden />
        </button>
        <p className="rc-month" aria-live="polite">{fmt(`${month}-01`, { month: "long", year: "numeric" })}</p>
        <button type="button" className="rc-nav" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month">
          <ChevronRight size={18} aria-hidden />
        </button>
      </div>
      <div className="rc-wd" aria-hidden>
        {WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}
      </div>
      <div ref={grid} className="rc-grid" role="group" aria-label="Choose your dates" onKeyDown={onKey} onMouseLeave={() => setHover(null)}>
        {days.map((d, i) => {
          if (!d) return <span key={`b${i}`} className="rc-cell" aria-hidden />;
          const off = d < min || (!!max && d > max);
          const isStart = d === lo;
          const isEnd = !!hi && d === hi;
          const inside = !!lo && !!hi && d >= lo && d <= hi;
          const preview = !!first && inside;
          const wd = WEEKDAY_NAMES[(i % 7)];
          return (
            <span key={d} className="rc-cell" data-in={inside || undefined} data-start={isStart || undefined} data-end={isEnd || undefined} data-preview={preview || undefined}>
              <button
                type="button"
                className="rc-day tnum"
                data-day={d}
                data-today={d === today || undefined}
                disabled={off}
                tabIndex={d === tabDay ? 0 : -1}
                aria-pressed={isStart || isEnd}
                aria-label={`${wd} ${fmt(d, { day: "numeric", month: "long", year: "numeric" })}${isStart ? ", arriving" : isEnd ? ", leaving" : ""}`}
                onClick={() => pick(d)}
                onMouseEnter={() => first && setHover(d)}
              >
                {Number(d.slice(8))}
              </button>
            </span>
          );
        })}
      </div>
      <p className="rc-hint" aria-live="polite">
        {hint}
        {!first && start && end && <b className="tnum"> · {nightsBetween(start, end)} {nightsBetween(start, end) === 1 ? "night" : "nights"}</b>}
      </p>
      {first && (
        <div className="rc-lengths" role="group" aria-label="Or a trip of">
          {LENGTHS.map((l) => (
            <button key={l.nights} type="button" className="chip press" onClick={() => length(l.nights)}>{l.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The dates, once picked: one line to read, a tap to change them. */
export function DatesRow({ start, end, onOpen }: { start: string; end: string; onOpen: () => void }) {
  const n = nightsBetween(start, end);
  return (
    <button type="button" className="dates-row press" onClick={onOpen} aria-label={`Dates: ${shortDay(start)} to ${shortDay(end)}, ${n} nights. Change them`}>
      <span className="dates-row-icon" aria-hidden><CalendarDays size={17} /></span>
      <span className="dates-row-main tnum">
        <span className="dates-row-dates">
          {shortDay(start)} <span className="dates-row-arrow" aria-hidden>→</span> {shortDay(end)}
        </span>
        <span className="dates-row-n">{n} {n === 1 ? "night" : "nights"}</span>
      </span>
      <span className="dates-row-change">Change</span>
    </button>
  );
}
