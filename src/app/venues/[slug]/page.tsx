import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Accessibility, Navigation } from "lucide-react";
import { ensureFresh, getVenueBySlug, searchEvents, venuesInCity, waitFor } from "@/lib/store";
import { LocationMap } from "@/components/event-detail-client";
import { DemoBadge, EmptyState, Notice } from "@/components/ui";
import { FollowButton } from "@/components/follow-button";
import { Footer } from "@/components/footer";
import { CommunityPanel } from "@/components/community/community-panel";
import { MonthList, NextUp } from "@/components/event-list-parts";
import { WeatherNow } from "@/components/weather";
import { getCategory } from "@/lib/categories";
import { shareImage, ldJson, venueLd } from "@/lib/structured-data";
import { KeepExploring } from "@/components/keep-exploring";
import { haversineKm } from "@/lib/geo";

export const dynamic = "force-dynamic";
type P = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const { slug } = await params;
  await ensureFresh();
  const v = getVenueBySlug(slug);
  if (!v) return { title: "Venue not found" };
  return {
    title: `${v.name}, ${v.city}: events and tickets`,
    description: `What's on at ${v.name} in ${v.city}, with dates and ticket options.`,
    alternates: { canonical: `/venues/${v.slug}` },
    robots: v.provenance.isDemo ? { index: false, follow: false } : undefined,
    ...shareImage(searchEvents({ venue: v.slug, pageSize: 10, sort: "date" }).items, `${v.name}, ${v.city}`),
  };
}

export default async function VenuePage({ params }: { params: P }) {
  const { slug } = await params;
  await ensureFresh();
  // A server that has just started may still be loading its source.
  const v = await waitFor(() => getVenueBySlug(slug));
  if (!v) notFound();
  const res = searchEvents({ venue: v.slug, pageSize: 80, sort: "date" });
  const type = v.venueType?.replace(/_/g, " ");
  const [next, ...later] = res.items;
  // What this place mostly hosts, from what's on.
  const kinds = new Map<string, number>();
  for (const c of res.items) if (getCategory(c.categorySlug)) kinds.set(c.categorySlug, (kinds.get(c.categorySlug) ?? 0) + 1);
  const mostly = [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([slug]) => ({ slug, name: getCategory(slug)!.name }));
  // Other places in the same city with something on, the closest first.
  const around = v.cityId
    ? venuesInCity(v.cityId)
        .filter((o) => o.slug !== v.slug)
        .map((o) => ({ ...o, km: haversineKm(v.lat, v.lng, o.lat, o.lng) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, 6)
    : [];
  const facts: [string, string][] = [];
  if (v.capacity) facts.push(["Capacity", v.capacity.toLocaleString("en-GB")]);
  if (v.indoor !== undefined) facts.push(["Setting", v.indoor ? "Indoor" : "Outdoor"]);
  facts.push(["Local time zone", v.timeZone.replace(/_/g, " ")]);

  return (
    <>
      <main className="mx-auto max-w-[1200px] px-4 sm:px-6 pt-8">
        {!v.provenance.isDemo && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(venueLd(v, res.items)) }} />}
        <nav aria-label="Breadcrumb" className="t-small text-text-3 mb-4 flex flex-wrap items-center gap-1">
          <Link href="/destinations" className="inline-block py-1 hover:text-text">Destinations</Link>
          {v.cityId && (<><span aria-hidden>/</span><Link href={`/destinations/${v.cityId}`} className="inline-block py-1 hover:text-text">{v.city}</Link></>)}
          <span aria-hidden>/</span><span className="py-1 text-text-2">Venue</span>
        </nav>
        {v.provenance.isDemo && <div className="mb-5"><Notice tone="demo">This venue is fictional. Its location is a demonstration point near the real city centre.</Notice></div>}
        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] items-center">
          <div>
            <p className="t-small text-text-2 flex items-center gap-2 capitalize">{type ?? "Venue"}{v.provenance.isDemo && <DemoBadge />}</p>
            <h1 className="t-display mt-2">{v.name}</h1>
            <p className="t-body text-text-2 mt-2">
              {[v.address, v.city, v.country].filter(Boolean).join(", ")}
              <WeatherNow lat={v.lat} lng={v.lng} />
            </p>
            <p className="t-small text-text-3 mt-3 tnum">
              {res.total ? `${res.total.toLocaleString("en-GB")} upcoming ${res.total === 1 ? "date" : "dates"}` : "Nothing listed right now"}
              {mostly.length > 0 && (
                <>
                  {" · mostly "}
                  {mostly.map((m, i) => (
                    <Fragment key={m.slug}>
                      {i > 0 && ", "}
                      {v.cityId ? <Link href={`/events?city=${v.cityId}&cat=${m.slug}`} className="underline decoration-line-strong underline-offset-4 hover:text-text">{m.name.toLowerCase()}</Link> : m.name.toLowerCase()}
                    </Fragment>
                  ))}
                </>
              )}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <FollowButton kind="venue" id={v.slug} name={v.name} />
              <a className="btn btn-secondary btn-sm" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`}><Navigation size={14} aria-hidden /> Directions</a>
              {v.url && <a className="btn btn-secondary btn-sm" href={v.url} target="_blank" rel="noopener noreferrer">Venue website</a>}
              {v.cityId && <Link className="btn btn-ghost btn-sm" href={`/destinations/${v.cityId}`}>More in {v.city}</Link>}
            </div>
          </div>
          {next ? <NextUp c={next} /> : <LocationMap lat={v.lat} lng={v.lng} label={v.name} group="other" />}
        </div>
        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
          <section aria-labelledby="on">
            <h2 id="on" className="t-h2">{next ? "After that" : "What\u2019s on"}</h2>
            {later.length ? (
              <MonthList items={later} label="What's on" />
            ) : (
              <div className="mt-3"><EmptyState title={next ? "That's the only date listed" : "Nothing listed here right now"} body="Follow this venue to keep it in My World." /></div>
            )}
          </section>
          <aside className="grid gap-4 lg:sticky lg:top-20" aria-label="About the venue">
            {next && <LocationMap lat={v.lat} lng={v.lng} label={v.name} group={next.groupSlug ?? "other"} />}
            <div className="side-card">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 t-small">
                {facts.map(([k, val]) => (<Fragment key={k}><dt className="text-text-3">{k}</dt><dd className="tnum">{val}</dd></Fragment>))}
              </dl>
              <h2 className="t-small font-semibold mt-4 flex items-center gap-1.5"><Accessibility size={15} className="text-text-3" aria-hidden />Accessibility</h2>
              {v.accessibility?.length ? (
                <ul className="t-small text-text-2 mt-1 list-disc pl-4">{v.accessibility.map((a) => <li key={a}>{a}</li>)}</ul>
              ) : (
                <p className="t-small text-text-3 mt-1">Nothing published by the venue yet. Ask the venue before you go.</p>
              )}
            </div>
            {around.length > 0 && (
              <section className="side-card" aria-labelledby="around">
                <h2 id="around" className="t-small font-semibold">Other venues nearby</h2>
                <ul className="mt-1.5 divide-y divide-line">
                  {around.map((o) => (
                    <li key={o.slug}>
                      <Link href={`/venues/${o.slug}`} className="flex items-baseline justify-between gap-3 py-2 t-small hover:text-cyan">
                        <span className="min-w-0 truncate font-medium">{o.name}</span>
                        <span className="text-text-3 tnum shrink-0">{o.km < 1 ? `${Math.round(o.km * 1000)} m` : `${o.km.toFixed(1)} km`} · {o.upcoming}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link href={`/destinations/${v.cityId}`} className="see-all t-small text-text-2 hover:text-text mt-2">All of {v.city} →</Link>
              </section>
            )}
          </aside>
        </div>
        <CommunityPanel target={`v:${v.slug}`} mode="place" title={v.name} />
        <KeepExploring
          links={[
            ...mostly.slice(0, 2).map((m) => (v.cityId ? { href: `/events?city=${v.cityId}&cat=${m.slug}`, label: `${m.name} in ${v.city}` } : null)),
            v.cityId ? { href: `/destinations/${v.cityId}`, label: `${v.city} city guide` } : null,
            v.cityId ? { href: `/events?city=${v.cityId}`, label: `Everything on in ${v.city}` } : null,
            v.cityId ? { href: `/mixtape?c=${v.cityId}`, label: `Plan a weekend in ${v.city}` } : null,
          ]}
        />
      </main>
      <Footer />
    </>
  );
}
