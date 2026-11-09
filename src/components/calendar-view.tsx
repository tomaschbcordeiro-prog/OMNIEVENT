"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { SearchFilters } from "@/lib/types";
import { filtersToParams } from "@/lib/search/params";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A month of the search on a calendar: each day with how many events match it, shaded by how
 * busy it is. Tapping a day shows that day's events.
 */
export function CalendarView({ query, onPickDay }: { query: SearchFilters; onPickDay: (day: string) => void }) {
  // The visitor's today (their own clock), known once in the browser.
  const [today, setToday] = useState<string | null>(null);
  const [month, setMonth] = useState<{ y: number; m: number } | null>(null);
  useEffect(() => {
    const now = new Date();
    setToday(ymd(now.getFullYear(), now.getMonth(), now.getDate()));
    // Opens on the month the search starts in, else this one.
    const from = query.from ? new Date(`${query.from}T12:00:00Z`) : null;
    setMonth(from ? { y: from.getUTCFullYear(), m: from.getUTCMonth() } : { y: now.getFullYear(), m: now.getMonth() });
    // Only on first showing: later searches keep the month being looked at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = month ? new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate() : 0;
  const start = month ? ymd(month.y, month.m, 1) : "";
  // The search without its own dates (the calendar asks day by day).
  const base = useMemo(() => filtersToParams({ ...query, from: undefined, to: undefined, page: undefined, pageSize: undefined, sort: undefined }).toString(), [query]);
  const [counts, setCounts] = useState<{ key: string; n: number[] } | null>(null);
  const key = `${base}|${start}|${days}`;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!month) return;
    const ctrl = new AbortController();
    setFailed(false);
    fetch(`/api/geo/days?${base}${base ? "&" : ""}start=${start}&n=${days}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { counts: number[] }) => setCounts({ key, n: j.counts }))
      .catch((e: Error) => e.name !== "AbortError" && setFailed(true));
    return () => ctrl.abort();
  }, [key, base, start, days, month]);

  if (!month) return <div className="skeleton h-80 rounded-[var(--radius-l)]" aria-hidden />;
  const n = counts?.key === key ? counts.n : null;
  const max = Math.max(1, ...(n ?? [0]).filter((_, i) => !today || ymd(month.y, month.m, i + 1) >= today));
  // Monday-first: blank cells before the 1st.
  const lead = (new Date(Date.UTC(month.y, month.m, 1)).getUTCDay() + 6) % 7;
  const title = new Date(Date.UTC(month.y, month.m, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const shift = (d: number) =>
    setMonth((cur) => {
      const { y, m } = cur ?? month;
      return { y: y + Math.floor((m + d) / 12), m: (((m + d) % 12) + 12) % 12 };
    });
  const thisMonth = today?.slice(0, 7) === start.slice(0, 7);
  const picked = query.from && query.from === query.to ? query.from : null;

  return (
    <section className="cal panel-in" aria-label={`Calendar, ${title}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Previous month" onClick={() => shift(-1)} disabled={thisMonth}>
          <ChevronLeft size={18} aria-hidden />
        </button>
        <p className="t-h3 flex items-center gap-2" aria-live="polite">
          {title}
          {!n && !failed && <Loader2 size={15} className="animate-spin text-text-3" aria-hidden />}
        </p>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRight size={18} aria-hidden />
        </button>
      </div>
      {failed && <p className="t-small text-text-2 mb-2">Couldn&apos;t count this month&apos;s events. Try again in a moment.</p>}
      <div className="cal-grid">
        {WEEKDAYS.map((w) => (
          <span key={w} className="cal-weekday" aria-hidden>
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`b${i}`} aria-hidden />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = ymd(month.y, month.m, i + 1);
          const count = n?.[i];
          const past = !!today && day < today;
          // Up to 45% of the accent: the day's text stays readable on the busiest.
          const heat = count && !past ? Math.round(8 + (count / max) * 37) : 0;
          const label = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
          return (
            <button
              key={day}
              type="button"
              className="cal-day"
              data-today={day === today || undefined}
              data-picked={day === picked || undefined}
              data-past={past || undefined}
              disabled={past || count === 0}
              style={heat ? ({ "--heat": heat } as React.CSSProperties) : undefined}
              aria-label={past ? `${label}: past` : `${label}: ${count == null ? "counting" : `${count.toLocaleString()} ${count === 1 ? "event" : "events"}`}`}
              onClick={() => onPickDay(day)}
            >
              <span className="cal-num">{i + 1}</span>
              <span className="cal-count tnum">{past || count == null ? "" : count ? (count > 999 ? `${Math.round(count / 100) / 10}k` : count) : "–"}</span>
            </button>
          );
        })}
      </div>
      <p className="t-micro text-text-3 mt-3">Tap a day to see its events. Darker days have more on.</p>
    </section>
  );
}
