import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDestination } from "@/lib/destinations";
import { ensureFresh, getParticipantBySlug, searchEvents, waitForData } from "@/lib/store";
import { EventRow } from "@/components/event-card";
import { MonthList, NextUp } from "@/components/event-list-parts";
import { ClusterMap } from "@/components/cluster-map";
import { DemoBadge, EmptyState, Notice } from "@/components/ui";
import { FollowButton } from "@/components/follow-button";
import { Footer } from "@/components/footer";
import { CommunityPanel } from "@/components/community/community-panel";

export const dynamic = "force-dynamic";
type P = Promise<{ slug: string }>;

const KIND: Record<string, string> = { artist: "Artist", team: "Team", athlete: "Athlete", speaker: "Speaker", performer: "Performer", organizer: "Organiser", production: "Production", competition: "Competition" };

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const { slug } = await params;
  await ensureFresh();
  const p = getParticipantBySlug(slug);
  if (!p) return { title: "Not found" };
  return {
    title: `${p.name}: upcoming events and tickets`,
    description: `Upcoming events featuring ${p.name}, with dates, venues and ticket options.`,
    alternates: { canonical: `/participants/${p.slug}` },
    robots: p.provenance.isDemo ? { index: false, follow: false } : undefined,
  };
}

export default async function ParticipantPage({ params }: { params: P }) {
  const { slug } = await params;
  await ensureFresh();
  let p = getParticipantBySlug(slug);
  // A server that has just started may still be loading its source.
  if (!p) {
    await waitForData(20000);
    p = getParticipantBySlug(slug);
  }
  if (!p) notFound();
  const res = searchEvents({ participant: p.slug, pageSize: 80, sort: "date" });
  const past = searchEvents({ participant: p.slug, status: ["completed"], from: "2000-01-01", pageSize: 10 });
  const [next, ...later] = res.items;
  // Where they're on: each city once, with how many dates, in the order they come up.
  const where = new Map<string, { name: string; id?: string; n: number }>();
  for (const c of res.items) {
    const k = c.cityId ?? c.city;
    const w = where.get(k);
    if (w) w.n++;
    // A metro area goes by its city's name (Amadora and Cascais games count as Lisbon).
    else where.set(k, { name: (c.cityId && getDestination(c.cityId)?.name) || c.city, id: c.cityId, n: 1 });
  }
  const cities = [...where.values()];

  return (
    <>
      <main className="mx-auto max-w-[1200px] px-4 sm:px-6 pt-8">
        <nav aria-label="Breadcrumb" className="t-small text-text-3 mb-4 flex flex-wrap items-center gap-1">
          <Link href="/events" className="inline-block py-1 hover:text-text">Events</Link>
          <span aria-hidden>/</span><span className="py-1 text-text-2">{KIND[p.kind] ?? "Performer"}</span>
        </nav>
        {p.provenance.isDemo && <div className="mb-5"><Notice tone="demo">This is a fictional profile created for demonstration.</Notice></div>}
        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] items-center">
          <div>
            <p className="t-small text-text-2 flex items-center gap-2">{KIND[p.kind] ?? p.kind}{p.country && <span className="text-text-3">, {p.country}</span>}{p.provenance.isDemo && <DemoBadge />}</p>
            <h1 className="t-display mt-2">{p.name}</h1>
            {p.description && <p className="t-body text-text-2 mt-3 measure">{p.description}</p>}
            <p className="t-small text-text-3 mt-3 tnum">
              {res.total ? `${res.total.toLocaleString("en-GB")} upcoming ${res.total === 1 ? "date" : "dates"}` : "No upcoming dates listed"}
              {cities.length > 1 && ` in ${cities.length}${res.total > res.items.length ? "+" : ""} cities`}
              {cities.length === 1 && ` in ${cities[0].name}`}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <FollowButton kind="participant" id={p.slug} name={p.name} />
              {p.url && <a className="btn btn-secondary btn-sm" href={p.url} target="_blank" rel="noopener noreferrer">Official page</a>}
            </div>
            <p className="t-micro text-text-3 mt-2">Following keeps {p.name} in My World.</p>
          </div>
          {next ? (
            <NextUp c={next} showPlace />
          ) : (
            <div className="mt-3"><EmptyState title="No upcoming events listed" body="Our sources don't list anything right now. Follow to keep this in My World." action={<Link href="/events" className="btn btn-secondary btn-sm">Browse all events</Link>} /></div>
          )}
        </div>
        {next && (
          <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
            <section aria-labelledby="up">
              <h2 id="up" className="t-h2">After that</h2>
              {later.length ? (
                <MonthList items={later} label="Upcoming" />
              ) : (
                <p className="t-body text-text-2 mt-2">That&apos;s the only date listed for now.</p>
              )}
            </section>
            <aside className="grid gap-4 lg:sticky lg:top-20" aria-label="Where they're on">
              <ClusterMap params={`participant=${encodeURIComponent(p.slug)}`} initial={{ lat: next.lat, lng: next.lng, zoom: cities.length > 1 ? 1.2 : 9 }} className="h-64" />
              {cities.length > 1 && (
                <div className="side-card">
                  <h2 className="t-small font-semibold">On in</h2>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {cities.slice(0, 24).map((w) => (
                      <li key={w.id ?? w.name}>
                        {w.id ? (
                          <Link href={`/destinations/${w.id}`} className="city-chip">{w.name}{w.n > 1 && <span className="tnum">{w.n}</span>}</Link>
                        ) : (
                          <span className="city-chip">{w.name}{w.n > 1 && <span className="tnum">{w.n}</span>}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </aside>
          </div>
        )}
        {past.items.length > 0 && (
          <section className="mt-10" aria-labelledby="past">
            <h2 id="past" className="t-h3 text-text-2">Recently past</h2>
            <ul className="divide-y divide-line mt-2 opacity-75">{past.items.map((c) => <EventRow key={c.id} c={c} />)}</ul>
          </section>
        )}
        <CommunityPanel target={`p:${p.slug}`} mode="person" title={p.name} />
      </main>
      <Footer />
    </>
  );
}
