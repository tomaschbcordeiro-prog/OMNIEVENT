"use client";

import { useEffect, useState } from "react";

/**
 * A live countdown to an event: "Starts in 2d 04:12:09", then "Happening now · ends in 1h 20m",
 * then "This event has ended". With repeat performances it counts to the next one. It only
 * renders in the browser (the time on the server would be stale by the time it's read).
 */
export function Countdown({ starts, durationMinutes = 120, end }: { starts: string[]; durationMinutes?: number; end?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now == null) return <span className="countdown countdown--empty" aria-hidden />;

  const len = durationMinutes * 60000;
  const shows = starts.map((s) => Date.parse(s)).filter(Number.isFinite).sort((a, b) => a - b);
  const until = (s: number) => (end && shows.length === 1 ? Date.parse(end) : s + len);
  const live = shows.find((s) => s <= now && now < until(s));
  const next = shows.find((s) => s > now);

  if (live !== undefined)
    return (
      <span className="countdown countdown--live" role="timer" aria-live="off">
        <span className="live-dot live-dot--on" aria-hidden /> Happening now
        <span className="countdown-sub">· ends in {short(until(live) - now)}</span>
      </span>
    );
  if (next === undefined)
    return (
      <span className="countdown countdown--past" role="timer" aria-live="off">
        This event has ended
      </span>
    );
  const ms = next - now;
  const days = Math.floor(ms / 864e5);
  // Far off: just the days. Close: the clock ticks, second by second.
  if (days >= 30)
    return (
      <span className="countdown" role="timer" aria-live="off">
        ⏳ In {days} days
      </span>
    );
  const h = Math.floor((ms % 864e5) / 36e5);
  const m = Math.floor((ms % 36e5) / 6e4);
  const s = Math.floor((ms % 6e4) / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="countdown" role="timer" aria-live="off" aria-label={`Starts in ${days ? `${days} days, ` : ""}${h} hours and ${m} minutes`}>
      <span aria-hidden>⏳</span> Starts in
      <span className="countdown-digits tnum" aria-hidden>
        {days > 0 && <b>{days}d</b>}
        <b>{p(h)}</b>:<b>{p(m)}</b>:<b key={s} className="countdown-tick">{p(s)}</b>
      </span>
    </span>
  );
}

function short(ms: number): string {
  const m = Math.max(1, Math.round(ms / 6e4));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${Math.round(h / 24)} days`;
}
