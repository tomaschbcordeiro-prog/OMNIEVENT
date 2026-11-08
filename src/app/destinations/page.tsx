import { GROUP_HEX, getCategory } from "@/lib/categories";
import { WeatherNow } from "@/components/weather";
import type { Metadata } from "next";
import Link from "next/link";
import { ensureFresh, cityStats } from "@/lib/store";
import { CONTINENTS, CITIES } from "@/lib/destinations";
import { ClusterMap } from "@/components/cluster-map";
import { Footer } from "@/components/footer";
import { HerePill } from "@/components/here-pill";
import { getHere } from "@/lib/here";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Destinations",
  description: "Explore events by continent, country and city, and plan a trip around the experiences you want.",
  alternates: { canonical: "/destinations" },
};

export default async function DestinationsPage() {
  await ensureFresh();
  const stats = cityStats();
  const here = await getHere();
  // The eight busiest cities, each with its main kinds of event.
  const busiest = CITIES.map((c) => ({ c, s: stats[c.id] }))
    .filter((x): x is { c: (typeof CITIES)[number]; s: NonNullable<typeof x.s> } => !!x.s && x.s.total >= 50)
    .sort((a, b) => b.s.total - a.s.total)
    .slice(0, 8)
    .map((x) => ({ ...x, top: Object.entries(x.s.groups).sort((a, b) => b[1] - a[1]).slice(0, 5) }));
  return (
    <>
      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr] items-end">
          <div>
            <h1 className="t-display">Go where it&apos;s <em>happening</em></h1>
            <p className="t-lede text-text-2 mt-3">
              Pick a city to see everything on during your dates, then build a trip across cities.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/my-world?tab=trips" className="btn btn-primary">Plan a trip</Link>
              <Link href="/?view=globe" className="btn btn-secondary">Explore on the globe</Link>
            </div>
            {here.city ? (
              <div className="near-card mt-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="t-micro uppercase tracking-[0.14em] font-bold text-text-3">Near you</p>
                  <HerePill here={here} align="right" />
                </div>
                <Link href={`/destinations/${here.city.id}`} className="group mt-2 flex items-baseline justify-between gap-3">
                  <span className="near-card-city">{here.city.name}</span>
                  <span className="t-small text-text-2 tnum shrink-0 group-hover:text-text">{here.city.n.toLocaleString()} upcoming →</span>
                </Link>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/events?city=${here.city.id}`} className="btn btn-secondary btn-sm">What&apos;s on</Link>
                  <Link href={`/mixtape?c=${here.city.id}`} className="btn btn-sm mx-cta-light"><span aria-hidden>📼</span> Plan a weekend</Link>
                </div>
              </div>
            ) : (
              <div className="mt-6">
                <HerePill here={here} />
              </div>
            )}
          </div>
          <ClusterMap params="" initial={{ lat: 25, lng: 10, zoom: 0.6 }} className="h-72" />
        </div>

        {busiest.length > 0 && (
          <section className="mt-12" aria-labelledby="busiest">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="busiest" className="t-h2">Busiest right now</h2>
              <p className="t-small text-text-3 max-sm:hidden">Local time, weather and what&apos;s on</p>
            </div>
            <ul className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
              {busiest.map(({ c, s, top }) => (
                <li key={c.id}>
                  <Link href={`/destinations/${c.slug}`} className="city-card group" style={{ "--cat": GROUP_HEX[top[0]?.[0] ?? "other"] ?? GROUP_HEX.other } as React.CSSProperties}>
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="city-card-name">{c.name}</span>
                        <span className="block t-micro text-text-3 truncate">{c.country}</span>
                      </span>
                      <span className="t-small text-text-2 shrink-0 text-right">
                        <WeatherNow lat={c.lat} lng={c.lng} bare />
                        <span className="block t-micro text-text-3 tnum">{localClock(c.timeZone)}</span>
                      </span>
                    </span>
                    <span className="mt-4 block t-small tnum">
                      <strong className="text-text">{s.total.toLocaleString("en-GB")}</strong> <span className="text-text-3">upcoming</span>
                    </span>
                    {/* What's on there, by share: a bar of category colours. */}
                    <span className="city-card-bar" aria-hidden>
                      {top.map(([g, n]) => (
                        <span key={g} style={{ flexGrow: n, background: GROUP_HEX[g] ?? GROUP_HEX.other }} />
                      ))}
                    </span>
                    <span className="mt-1.5 block t-micro text-text-3 truncate">{top.slice(0, 2).map(([g]) => getCategory(g)?.name ?? g).join(" · ")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-14 grid gap-10">
          {CONTINENTS.map((ct) => {
            const cities = CITIES.filter((c) => c.continent === ct.id).sort((a, b) => (stats[b.id]?.total ?? 0) - (stats[a.id]?.total ?? 0));
            const total = cities.reduce((s, c) => s + (stats[c.id]?.total ?? 0), 0);
            const busy = cities.filter((c) => (stats[c.id]?.total ?? 0) > 0);
            // Cities with nothing listed right now: one quiet line of links, not a grid of zeros.
            const quiet = cities.filter((c) => !(stats[c.id]?.total ?? 0));
            return (
              <section key={ct.id} aria-labelledby={`ct-${ct.id}`} className="reveal grid gap-4 md:grid-cols-[220px_1fr] border-t border-line pt-6">
                <div>
                  <h2 id={`ct-${ct.id}`} className="t-h2">
                    <Link href={`/destinations/${ct.slug}`} className="hover:text-cyan">{ct.name}</Link>
                  </h2>
                  <p className="t-small text-text-3 tnum mt-1">{total ? `${total.toLocaleString()} upcoming` : "Coming soon"}</p>
                </div>
                <div>
                {busy.length > 0 && (
                <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2">
                  {busy.map((c) => (
                    <li key={c.id}>
                      <Link href={`/destinations/${c.slug}`} className="group flex items-baseline justify-between gap-2 py-1 border-b border-transparent hover:border-line">
                        <span className="truncate group-hover:text-cyan">{c.name}<span className="text-text-3 t-small">, {c.country}</span></span>
                        <span className="t-small text-text-3 tnum shrink-0">{stats[c.id]?.total ?? 0}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                )}
                {quiet.length > 0 && (
                  <p className={`t-small text-text-3 ${busy.length ? "mt-3" : ""}`}>
                    {busy.length ? "Also covered: " : "Nothing listed yet in "}
                    {quiet.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && ", "}
                        <Link href={`/destinations/${c.slug}`} className="hover:text-text hover:underline">{c.name}</Link>
                      </span>
                    ))}
                  </p>
                )}
                </div>
              </section>
            );
          })}
        </div>
      </main>
      <Footer />
    </>
  );
}

/** "Sun 09:12" in a city's own time. */
function localClock(tz?: string): string {
  try {
    return new Date().toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: tz ?? "UTC" });
  } catch {
    return "";
  }
}
