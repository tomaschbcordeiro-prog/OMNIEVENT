/** Weather codes in words and pictures (shared by the server and the browser). */

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
