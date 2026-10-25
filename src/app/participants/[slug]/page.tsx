import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureFresh, getParticipantBySlug, searchEvents } from "@/lib/store";
import { EventRow } from "@/components/event-card";
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
  const p = getParticipantBySlug(slug);
  if (!p) notFound();
  const res = searchEvents({ participant: p.slug, pageSize: 50, sort: "date" });
  const past = searchEvents({ participant: p.slug, status: ["completed"], from: "2000-01-01", pageSize: 10 });
  const cities = new Set(res.items.map((c) => c.city));

  return (
    <>
      <main className="mx-auto max-w-[1200px] px-4 sm:px-6 pt-8">
        {p.provenance.isDemo && <div className="mb-5"><Notice tone="demo">This is a fictional profile created for demonstration.</Notice></div>}
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr] items-start">
          <div>
            <p className="t-small text-text-2 flex items-center gap-2">{KIND[p.kind] ?? p.kind}{p.country && <span className="text-text-3">, {p.country}</span>}{p.provenance.isDemo && <DemoBadge />}</p>
            <h1 className="t-display mt-2">{p.name}</h1>
            {p.description && <p className="t-body text-text-2 mt-3 measure">{p.description}</p>}
            <p className="t-small text-text-3 mt-2 tnum">{res.total} upcoming {res.total === 1 ? "event" : "events"}{cities.size > 1 ? ` in ${cities.size} cities` : ""}</p>
            <div className="mt-4 flex gap-2">
              <FollowButton kind="participant" id={p.slug} name={p.name} />
              {p.url && <a className="btn btn-secondary btn-sm" href={p.url} target="_blank" rel="noopener noreferrer">Official page</a>}
            </div>
            <p className="t-micro text-text-3 mt-2">Following saves this to My World. Alerts need a notification service, which isn&apos;t connected yet.</p>
          </div>
          {res.total > 0 && <ClusterMap params={`participant=${encodeURIComponent(p.slug)}`} initial={{ lat: res.items[0].lat, lng: res.items[0].lng, zoom: 1.2 }} className="h-64" />}
        </div>
        <section className="mt-10" aria-labelledby="up">
          <h2 id="up" className="t-h2">Upcoming</h2>
          {res.items.length ? (
            <ul className="divide-y divide-line mt-2">{res.items.map((c) => <EventRow key={c.id} c={c} />)}</ul>
          ) : (
            <div className="mt-3"><EmptyState title="No upcoming events listed" body="Our sources don't list anything right now. Follow to keep this in My World." action={<Link href="/events" className="btn btn-secondary btn-sm">Browse all events</Link>} /></div>
          )}
        </section>
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
