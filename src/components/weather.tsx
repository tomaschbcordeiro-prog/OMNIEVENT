"use client";

import { useEffect, useState } from "react";
import { weatherLook } from "@/lib/weather-look";

/**
 * The weather where events are, from Open-Meteo (free, no key, CC BY 4.0), asked for by the
 * visitor's browser so a page never waits for it. Answers are kept for half an hour in this
 * browser.
 */

export interface DayWx {
  date: string;
  code: number;
  max: number;
  min: number;
  rain?: number;
}
export interface Wx {
  now?: { temp: number; code: number; day: boolean };
  days: DayWx[];
}

const memo = new Map<string, Promise<Wx | null>>();

export function loadForecast(lat: number, lng: number, days = 8): Promise<Wx | null> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)},${days}`;
  const store = `omnievent:wx:${key}`;
  let p = memo.get(key);
  if (p) return p;
  p = (async () => {
    try {
      const saved = JSON.parse(localStorage.getItem(store) ?? "null") as { at: number; wx: Wx } | null;
      if (saved && Date.now() - saved.at < 30 * 60000) return saved.wx;
    } catch {
      // storage unavailable
    }
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=${days}`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      const j = (await r.json()) as {
        current?: { temperature_2m?: number; weather_code?: number; is_day?: number };
        daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: (number | null)[] };
      };
      const d = j.daily;
      const wx: Wx = {
        now: typeof j.current?.temperature_2m === "number" && typeof j.current.weather_code === "number" ? { temp: Math.round(j.current.temperature_2m), code: j.current.weather_code, day: j.current.is_day !== 0 } : undefined,
        days: (d?.time ?? [])
          .map((date, i) => ({ date, code: d?.weather_code?.[i] ?? -1, max: Math.round(d?.temperature_2m_max?.[i] ?? NaN), min: Math.round(d?.temperature_2m_min?.[i] ?? NaN), rain: d?.precipitation_probability_max?.[i] ?? undefined }))
          .filter((x) => x.code >= 0 && Number.isFinite(x.max) && Number.isFinite(x.min)),
      };
      try {
        localStorage.setItem(store, JSON.stringify({ at: Date.now(), wx }));
      } catch {
        // private mode
      }
      return wx;
    } catch {
      return null;
    }
  })();
  memo.set(key, p);
  return p;
}

export function useForecast(lat: number | undefined, lng: number | undefined, days = 8): Wx | null {
  const [wx, setWx] = useState<Wx | null>(null);
  useEffect(() => {
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    let live = true;
    void loadForecast(lat, lng, days).then((w) => live && setWx(w));
    return () => {
      live = false;
    };
  }, [lat, lng, days]);
  return wx;
}

/** "☁️ 18° overcast" for right now (after a comma, to follow a place name; `bare` without). */
export function WeatherNow({ lat, lng, bare = false }: { lat: number; lng: number; bare?: boolean }) {
  const wx = useForecast(lat, lng);
  if (!wx?.now) return null;
  const look = weatherLook(wx.now.code, wx.now.day);
  if (bare)
    return (
      <span className="tnum" title={look.label}>
        {look.emoji} {wx.now.temp}°
      </span>
    );
  return (
    <span className="text-text-3">
      , {look.emoji} {wx.now.temp}° {look.label.toLowerCase()}
    </span>
  );
}

/** The week ahead as a strip of days. */
export function WeatherWeek({ lat, lng, place }: { lat: number; lng: number; place: string }) {
  const wx = useForecast(lat, lng);
  if (!wx || wx.days.length < 2) return null;
  return (
    <div className="mt-3 panel-in">
      <ul className="wx-strip no-scrollbar" aria-label={`Weather in ${place}, the coming days`}>
        {wx.days.slice(0, 7).map((w) => {
          const look = weatherLook(w.code);
          const day = new Date(`${w.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
          return (
            <li key={w.date} className="wx-day" title={`${look.label}${w.rain != null ? `, ${w.rain}% chance of rain` : ""}`}>
              <span className="t-micro text-text-3">{day}</span>
              <span className="wx-emoji" aria-hidden>{look.emoji}</span>
              <span className="sr-only">{look.label},</span>
              <span className="t-micro tnum">
                <strong>{w.max}°</strong> <span className="text-text-3">{w.min}°</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="t-micro text-text-3 mt-1">
        Weather:{" "}
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="underline decoration-line-strong hover:text-text">
          Open-Meteo
        </a>
      </p>
    </div>
  );
}

/** The forecast for one day (an event's), when it's within the week ahead. */
export function DayForecast({ lat, lng, date }: { lat: number; lng: number; date: string }) {
  const wx = useForecast(lat, lng);
  const w = wx?.days.find((x) => x.date === date);
  if (!w) return null;
  const look = weatherLook(w.code);
  return (
    <span className="block t-small text-text-2 mt-1.5 panel-in">
      <span aria-hidden>{look.emoji}</span> Forecast: {look.label.toLowerCase()}, {w.max}° / {w.min}°{w.rain != null && w.rain >= 20 ? `, ${w.rain}% chance of rain` : ""}
    </span>
  );
}
