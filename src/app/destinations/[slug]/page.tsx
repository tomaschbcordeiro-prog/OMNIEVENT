import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureFresh, searchEvents, venuesInCity, cityStats, matchingCards } from "@/lib/store";
import { getDestination, citiesIn, CONTINENTS } from "@/lib/destinations";
import { parseFilterParams, filtersToParams } from "@/lib/search/params";
import { GROUPS } from "@/lib/categories";
import { localDateKey } from "@/lib/format";
import type { SearchFilters } from "@/lib/types";
import { EventsBrowser } from "@/components/events-browser";
import { EventTile } from "@/components/event-card";
import { ClusterMap } from "@/components/cluster-map";
import { CategoryIcon, ShapeGlyph } from "@/components/ui";
import { FollowButton } from "@/components/follow-button";
import { Suspense } from "react";
import { Crosshair } from "lucide-react";
import { ContinueSearch } from "@/components/continue-search";
import { Footer } from "@/components/footer";
import { CommunityPanel } from "@/components/community/community-panel";

export const dynamic = "force-dynamic";
type P = Promise<{ slug: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const { slug } = await params;
  const d = getDestination(slug);
  if (!d) return { title: "Destination not found" };
  return {
    title: `Events in ${d.name}`,
    description: `Concerts, sport, theatre, festivals, museums and family activities in ${d.name}${d.country ? `, ${d.country}` : ""}. Filter by your trip dates and budget.`,
    alternates: { canonical: `/destinations/${d.slug}` },
  };
}

const HIGHLIGHTS: { title: string; cats: string[] }[] = [
  { title: "Festivals and culture", cats: ["festivals", "culture", "food-drink"] },
  { title: "Sport", cats: ["sports"] },
  { title: "Museums and attractions", cats: ["exhibitions", "attractions"] },
  { title: "For families", cats: ["family"] },
];

export default async function DestinationPage({ params, searchParams }: { params: P; searchParams: SP }) {
  const { slug } = await params;
  const d = getDestination(slug);
  if (!d || d.kind === "region") notFound();
  const sp = await searchParams;
  const raw = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") raw.set(k, v);
  await ensureFresh();
  const parsed = parseFilterParams(raw);
  const user: SearchFilters = parsed.ok ? parsed.filters : {};
  const place: SearchFilters = d.kind === "city" ? { city: d.id } : d.kind === "country" ? { country: d.countryCode } : { continent: d.id };
  const filters: SearchFilters = { ...user, ...place };
  const result = searchEvents(filters);
  const base: SearchFilters = { ...place, from: user.from, to: user.to, maxPrice: user.maxPrice, currency: user.currency, access: user.access, family: user.family };

  // 14-day (or trip-length) calendar of event counts, in the destination's local dates.
  const tz = d.timeZone ?? "UTC";
  const startKey = user.from ?? localDateKey(new Date(), tz);
  const days = Math.min(31, user.to ? Math.round((Date.parse(user.to) - Date.parse(startKey)) / 86400000) + 1 : 14);
  const all = matchingCards({ ...base, from: startKey, to: new Date(Date.parse(startKey) + (days - 1) * 86400000).toISOString().slice(0, 10) });
  const perDay = Array.from({ length: Math.max(1, days) }, (_, i) => {
    const key = new Date(Date.parse(startKey) + i * 86400000).toISOString().slice(0, 10);
    return { key, n: all.filter((c) => c.eventType !== "daily_attraction" && localDateKey(c.start, c.timeZone) === key).length };
  });
  const maxDay = Math.max(1, ...perDay.map((p) => p.n));
  const groups = Object.entries(result.facets.groups).sort((a, b) => b[1] - a[1]);
  const venues = d.kind === "city" ? venuesInCity(d.id).slice(0, 8) : [];
  const stats = cityStats();
  const childCities = d.kind !== "city" ? citiesIn(d).sort((a, b) => (stats[b.id]?.total ?? 0) - (stats[a.id]?.total ?? 0)) : [];
  const nowLocal = d.timeZone ? new Intl.DateTimeFormat("en-GB", { timeZone: d.timeZone, hour: "2-digit", minute: "2-digit", weekday: "short" }).format(new Date()) : null;
  const zoom = d.kind === "city" ? 10.5 : d.kind === "country" ? 4.6 : 2;
  const parent = d.kind === "city" ? getDestination(d.parentId!) : d.kind === "country" ? CONTINENTS.find((c) => c.id === d.continent) : undefined;

  return (
    <>
      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-8">
        <nav aria-label="Breadcrumb" className="t-small text-text-3 mb-4 flex flex-wrap gap-1">
          <Link href="/destinations" className="hover:text-text">Destinations</Link>
          {d.kind === "city" && d.continent && (<><span aria-hidden>/</span><Link href={`/destinations/${d.continent}`} className="hover:text-text">{getDestination(d.continent)?.name}</Link></>)}
          {parent && (<><span aria-hidden>/</span><Link href={`/destinations/${parent.slug}`} className="hover:text-text">{parent.name}</Link></>)}
        </nav>

        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] items-start">
          <div>
            <h1 className="t-display">{d.name}</h1>
            <p className="t-body text-text-2 mt-2">
              {d.kind === "city" ? d.country : d.kind === "country" ? getDestination(d.continent!)?.name : "Continent"}
              {nowLocal && <span className="text-text-3">, local time {nowLocal}</span>}
            </p>
            <p className="t-small text-text-3 mt-1 tnum">
              {result.total.toLocaleString()} upcoming events listed{d.currency ? `, prices usually in ${d.currency}` : ""}. {d.lat.toFixed(2)}°, {d.lng.toFixed(2)}°
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <FollowButton kind="destination" id={d.id} name={d.name} />
              {/* Cities open as a radius search; larger areas just open the map there. */}
              <Link
                className="btn btn-secondary btn-sm"
                href={d.kind === "city" ? `/?${filtersToParams({ ...user, near: { lat: d.lat, lng: d.lng, radiusKm: 15 }, nearLabel: `${d.name}${d.country ? `, ${d.country}` : ""}`, city: undefined, page: undefined })}` : `/?at=${d.lat.toFixed(3)},${d.lng.toFixed(3)},${zoom},0,0`}
              >
                <Crosshair size={14} aria-hidden /> Explore on the map
              </Link>
            </div>

            <form className="mt-6 grid grid-cols-2 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end rounded-[var(--radius-l)] border border-line p-4" action={`/destinations/${d.slug}`}>
              <p className="col-span-full t-h3">Your trip dates</p>
              <div>
                <label className="label" htmlFor="from">Arriving</label>
                <input id="from" name="from" type="date" className="field" defaultValue={user.from} />
              </div>
              <div>
                <label className="label" htmlFor="to">Leaving</label>
                <input id="to" name="to" type="date" className="field" defaultValue={user.to} />
              </div>
              {user.categories && <input type="hidden" name="cat" value={user.categories.join(",")} />}
              <button className="btn btn-primary col-span-full sm:col-span-1">Show events</button>
            </form>
          </div>
          <ClusterMap params={filtersToParams(base).toString()} initial={{ lat: d.lat, lng: d.lng, zoom }} className="h-80" />
        </div>

        <section className="mt-10" aria-labelledby="cal">
          <h2 id="cal" className="t-h3">{user.from ? "Events per day of your trip" : "Next two weeks"}</h2>
          <p className="t-micro text-text-3">Dated events per local day. Daily attractions are not counted.</p>
          <ol className="mt-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${perDay.length}, minmax(0, 1fr))` }}>
            {perDay.map((p) => {
              const dt = new Date(`${p.key}T12:00:00Z`);
              return (
                <li key={p.key}>
                  <Link href={`/destinations/${d.slug}?${filtersToParams({ ...user, from: p.key, to: p.key }).toString()}#all`} className="group flex flex-col items-center gap-1" aria-label={`${p.n} events on ${dt.toDateString()}`}>
                    <span className="flex h-16 w-full items-end justify-center rounded-[4px] bg-panel">
                      <span className="w-full rounded-[4px] bg-cyan/60 group-hover:bg-cyan transition-colors" style={{ height: `${Math.max(4, (p.n / maxDay) * 100)}%` }} />
                    </span>
                    <span className="t-micro text-text-3 tnum leading-tight text-center">
                      {dt.toLocaleDateString("en-GB", { weekday: "narrow", timeZone: "UTC" })}
                      <span className="block text-text-2">{dt.getUTCDate()}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>

        {groups.length > 0 && (
          <section className="mt-10" aria-labelledby="mix">
            <h2 id="mix" className="t-h3">What&apos;s on here</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {groups.map(([g, n]) => (
                <li key={g}>
                  <Link href={`/destinations/${d.slug}?${filtersToParams({ ...user, categories: [g] }).toString()}#all`} className="chip" data-active={user.categories?.includes(g)}>
                    <ShapeGlyph group={g} size={9} /> {GROUPS.find((x) => x.slug === g)?.name.split(" &")[0]} <span className="text-text-3 tnum">{n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-10 grid gap-10">
          {HIGHLIGHTS.map((h) => {
            const items = searchEvents({ ...base, categories: h.cats, pageSize: 4, status: undefined }).items;
            if (!items.length) return null;
            return (
              <section key={h.title} aria-label={h.title}>
                <div className="flex items-baseline justify-between">
                  <h2 className="t-h2 flex items-center gap-2"><CategoryIcon slug={h.cats[0]} size={18} />{h.title}</h2>
                  <Link className="t-small text-text-2 hover:text-cyan" href={`/destinations/${d.slug}?${filtersToParams({ ...user, categories: h.cats }).toString()}#all`}>See all</Link>
                </div>
                <ul className="mt-3 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                  {items.map((c) => <EventTile key={c.id} c={c} />)}
                </ul>
              </section>
            );
          })}
        </div>

        {venues.length > 0 && (
          <section className="mt-12" aria-labelledby="venues">
            <h2 id="venues" className="t-h2">Venues</h2>
            <p className="t-small text-text-3">Ordered by number of listed upcoming events.</p>
            <ul className="mt-3 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
              {venues.map((v) => (
                <li key={v.id} className="border-b border-line">
                  <Link href={`/venues/${v.slug}`} className="flex items-baseline justify-between gap-2 py-2.5 hover:text-cyan">
                    <span className="truncate">{v.name}</span>
                    <span className="t-small text-text-3 tnum">{v.upcoming}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {childCities.length > 0 && (
          <section className="mt-12" aria-labelledby="cities">
            <h2 id="cities" className="t-h2">Cities</h2>
            <ul className="mt-3 grid gap-x-8 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
              {childCities.map((c) => (
                <li key={c.id} className="border-b border-line">
                  <Link href={`/destinations/${c.slug}`} className="flex items-baseline justify-between gap-2 py-2.5 hover:text-cyan">
                    <span className="truncate">{c.name}</span>
                    <span className="t-small text-text-3 tnum">{stats[c.id]?.total ?? 0}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {d.kind === "city" && <CommunityPanel target={`d:${d.id}`} mode="city" title={d.name} />}

        <section id="all" className="mt-12 scroll-mt-24" aria-labelledby="alltitle">
          <Suspense fallback={null}>
            <ContinueSearch keep={["near", "nearLabel", "city", "country", "continent"]} />
          </Suspense>
          <h2 id="alltitle" className="t-h2 mb-4">Everything in {d.name}</h2>
          <EventsBrowser result={result} filters={user} facets={result.facets} basePath={`/destinations/${d.slug}`} />
        </section>
      </main>
      <Footer />
    </>
  );
}
