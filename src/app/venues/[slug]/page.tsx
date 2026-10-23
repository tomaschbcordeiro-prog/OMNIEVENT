import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Accessibility, Navigation } from "lucide-react";
import { ensureFresh, getVenueBySlug, searchEvents } from "@/lib/store";
import { EventRow } from "@/components/event-card";
import { LocationMap } from "@/components/event-detail-client";
import { DemoBadge, EmptyState, Notice } from "@/components/ui";
import { FollowButton } from "@/components/follow-button";
import { Footer } from "@/components/footer";

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
  };
}

export default async function VenuePage({ params }: { params: P }) {
  const { slug } = await params;
  await ensureFresh();
  const v = getVenueBySlug(slug);
  if (!v) notFound();
  const res = searchEvents({ venue: v.slug, pageSize: 60, sort: "date" });
  const type = v.venueType?.replace(/_/g, " ");

  return (
    <>
      <main className="mx-auto max-w-[1200px] px-4 sm:px-6 pt-8">
        {v.provenance.isDemo && <div className="mb-5"><Notice tone="demo">This venue is fictional. Its location is a demonstration point near the real city centre.</Notice></div>}
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr] items-start">
          <div>
            <p className="t-small text-text-2 flex items-center gap-2 capitalize">{type ?? "Venue"}{v.provenance.isDemo && <DemoBadge />}</p>
            <h1 className="t-display mt-2">{v.name}</h1>
            <p className="t-body text-text-2 mt-2">
              {[v.address, v.city, v.country].filter(Boolean).join(", ")}
            </p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 t-small">
              {v.capacity && (<><dt className="text-text-3">Capacity</dt><dd className="tnum">{v.capacity.toLocaleString()}</dd></>)}
              <dt className="text-text-3">Setting</dt><dd>{v.indoor === undefined ? "Not stated" : v.indoor ? "Indoor" : "Outdoor"}</dd>
              <dt className="text-text-3">Time zone</dt><dd>{v.timeZone.replace("_", " ")}</dd>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <FollowButton kind="venue" id={v.slug} name={v.name} />
              <a className="btn btn-secondary btn-sm" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`}><Navigation size={14} aria-hidden /> Directions</a>
              {v.url && <a className="btn btn-secondary btn-sm" href={v.url} target="_blank" rel="noopener noreferrer">Venue website</a>}
              {v.cityId && <Link className="btn btn-ghost btn-sm" href={`/destinations/${v.cityId}`}>More in {v.city}</Link>}
            </div>
            <div className="mt-6">
              <h2 className="t-h3 flex items-center gap-2"><Accessibility size={16} className="text-text-3" aria-hidden />Accessibility</h2>
              {v.accessibility?.length ? (
                <ul className="t-small text-text-2 mt-1.5 list-disc pl-4">{v.accessibility.map((a) => <li key={a}>{a}</li>)}</ul>
              ) : (
                <p className="t-small text-text-2 mt-1.5">No accessibility information has been published for this venue.</p>
              )}
            </div>
          </div>
          <LocationMap lat={v.lat} lng={v.lng} label={v.name} group={res.items[0]?.groupSlug ?? "other"} />
        </div>
        <section className="mt-10" aria-labelledby="on">
          <h2 id="on" className="t-h2">What&apos;s on</h2>
          {res.items.length ? (
            <ul className="divide-y divide-line mt-2">{res.items.map((c) => <EventRow key={c.id} c={c} />)}</ul>
          ) : (
            <div className="mt-3"><EmptyState title="Nothing listed here right now" /></div>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
