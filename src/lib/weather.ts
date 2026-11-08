import "server-only";

/**
 * The weather where events are: now and for the next days, from Open-Meteo (free, no key,
 * CC BY 4.0). Answers are kept for half an hour; a slow or failing answer just leaves the
 * weather out.
 */

export interface Forecast {
  now?: { temp: number; code: number; day: boolean };
  days: { date: string; code: number; max: number; min: number; rain?: number }[];
}

export async function forecast(lat: number, lng: number, days = 7): Promise<Forecast | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=${days}`;
  try {
    const r = await fetch(url, { next: { revalidate: 1800 }, signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      current?: { temperature_2m?: number; weather_code?: number; is_day?: number };
      daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: (number | null)[] };
    };
    const d = j.daily;
    const out: Forecast = {
      now: typeof j.current?.temperature_2m === "number" && typeof j.current.weather_code === "number" ? { temp: Math.round(j.current.temperature_2m), code: j.current.weather_code, day: j.current.is_day !== 0 } : undefined,
      days: (d?.time ?? []).map((date, i) => ({
        date,
        code: d?.weather_code?.[i] ?? -1,
        max: Math.round(d?.temperature_2m_max?.[i] ?? NaN),
        min: Math.round(d?.temperature_2m_min?.[i] ?? NaN),
        rain: d?.precipitation_probability_max?.[i] ?? undefined,
      })).filter((x) => x.code >= 0 && Number.isFinite(x.max) && Number.isFinite(x.min)),
    };
    return out.now || out.days.length ? out : null;
  } catch {
    return null;
  }
}

/** An emoji and words for a WMO weather code. */
export function weatherLook(code: number, day = true): { emoji: string; label: string } {
  if (code === 0) return day ? { emoji: "☀️", label: "Clear" } : { emoji: "🌙", label: "Clear" };
  if (code === 1) return day ? { emoji: "🌤️", label: "Mostly clear" } : { emoji: "🌙", label: "Mostly clear" };
  if (code === 2) return { emoji: "⛅", label: "Partly cloudy" };
  if (code === 3) return { emoji: "☁️", label: "Overcast" };
  if (code === 45 || code === 48) return { emoji: "🌫️", label: "Fog" };
  if (code >= 51 && code <= 57) return { emoji: "🌦️", label: "Drizzle" };
  if (code >= 61 && code <= 67) return { emoji: "🌧️", label: "Rain" };
  if (code >= 71 && code <= 77) return { emoji: "❄️", label: "Snow" };
  if (code >= 80 && code <= 82) return { emoji: "🌦️", label: "Showers" };
  if (code === 85 || code === 86) return { emoji: "🌨️", label: "Snow showers" };
  if (code >= 95) return { emoji: "⛈️", label: "Thunderstorms" };
  return { emoji: "🌡️", label: "Weather" };
}
