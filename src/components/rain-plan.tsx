"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CloudRain } from "lucide-react";
import { useForecast, type DayWx } from "./weather";

/*
 * A plan for the rain. When a wet day is coming in a city in the next few days, a quiet note
 * says so and counts what's on that day under a roof (theatre, cinema and exhibitions: the
 * kinds that are almost always indoors), with one tap to see them. Nothing shows on dry days.
 */

const INDOOR = ["theatre", "cinema", "exhibitions"];
/** Weather codes for drizzle, rain, showers, snow and thunderstorms (WMO). */
const wetCode = (c: number) => (c >= 51 && c <= 67) || (c >= 71 && c <= 77) || (c >= 80 && c <= 86) || c >= 95;
const isWet = (d: DayWx) => ((d.rain ?? 0) >= 60 && wetCode(d.code)) || (d.rain ?? 0) >= 80;

function dayName(date: string): string {
  const today = new Date();
  const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (date === ymd(today)) return "today";
  if (date === ymd(tomorrow)) return "tomorrow";
  return `on ${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}`;
}

export function RainPlan({ lat, lng, place, slug }: { lat: number; lng: number; place: string; slug: string }) {
  const wx = useForecast(lat, lng);
  const day = useMemo(() => wx?.days.slice(0, 4).find(isWet), [wx]);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!day) return;
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A server that has only just started is still loading the catalogue, and a count then would
    // be too low: wait until it's all there (a minute at most), then count.
    const count = () =>
      fetch(`/api/events?city=${encodeURIComponent(slug)}&cat=${INDOOR.join(",")}&from=${day.date}&to=${day.date}&limit=1`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => setCount(typeof j?.total === "number" ? j.total : null))
        .catch(() => {});
    let tries = 0;
    const whenReady = () =>
      fetch("/api/ready", { cache: "no-store", signal: ctl.signal })
        .then((r) => r.json())
        .catch(() => null)
        .then((r) => {
          if (ctl.signal.aborted) return;
          if (r?.ready !== false || ++tries >= 24) void count();
          else timer = setTimeout(whenReady, 2500);
        });
    void whenReady();
    return () => {
      ctl.abort();
      clearTimeout(timer);
    };
  }, [day, slug]);
  if (!day || !count) return null;
  const href = `/destinations/${slug}?cat=${INDOOR.join(",")}&from=${day.date}&to=${day.date}#all`;
  return (
    <aside className="rain-plan panel-in" aria-label="A plan for the rain">
      <span className="rain-plan-icon" aria-hidden>
        <CloudRain size={20} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          Rain likely {dayName(day.date)}
          {day.rain != null && <span className="text-text-3 font-normal tnum"> · {day.rain}%</span>}
        </p>
        <p className="t-small text-text-2 mt-0.5">
          Theatre, cinema and exhibitions are almost always indoors: <strong className="text-text tnum">{count.toLocaleString("en-GB")}</strong> that day in {place}.
        </p>
      </div>
      <Link href={href} className="btn btn-secondary btn-sm press shrink-0">
        See them <ArrowRight size={14} aria-hidden />
      </Link>
    </aside>
  );
}
