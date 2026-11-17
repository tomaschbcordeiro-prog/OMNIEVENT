/**
 * Mundivi's mark and name.
 *
 * The mark: a planet whose meridians draw an "M", with one event lit up on it, the warm dot
 * that marks events on the globe. The name: "mundivi" in lower case, its two "i"s dotted with
 * that same warm light. One colour for the planet, one for the light: easy to remember, and it
 * reads at 16 pixels as well as on a poster.
 */

export const BRAND = { name: "Mundivi", blue: "#1463FF", deep: "#0A33B8", light: "#FFB800" } as const;

/** The mark on its own (favicon, app icon, the tab bar's globe). */
export function MundiviMark({ size = 24, ring, className = "" }: { size?: number; /** The ring round the light; by default the colour of the page behind it. */ ring?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <circle className="mark-globe" cx="15" cy="17" r="13" fill={BRAND.blue} />
      <path d="M9.2 22.6V13.9c0-2.4 2-3.1 3.3-1.4L15 16l2.5-3.5c1.3-1.7 3.3-1 3.3 1.4v8.7" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle className={ring ? undefined : "mark-spark"} cx="25.2" cy="7.2" r="4.3" fill={BRAND.light} stroke={ring ?? "#fff"} strokeWidth="2" />
    </svg>
  );
}

/** "mundivi", with the dots of both i's lit like events. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`}>
      <span className="sr-only">Mundivi</span>
      <span aria-hidden>
        mund<span className="wordmark-i">ı</span>v<span className="wordmark-i">ı</span>
      </span>
    </span>
  );
}
