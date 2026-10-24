import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, MapPin, Users, ShieldCheck, Accessibility, Navigation, Globe2, Hotel, Plane, TriangleAlert, Database, ExternalLink } from "lucide-react";
import { ensureFresh, getEventView, searchEvents } from "@/lib/store";
import { formatEventDate, formatEventTime, tzAbbrev, relativeTime, ACCESS_META } from "@/lib/format";
import { getCategory, groupOf } from "@/lib/categories";
import { EventRow } from "@/components/event-card";
import { CategoryIcon, DemoBadge, Poster, Price, SaveButton, StatusBadge, Notice } from "@/components/ui";
import { AddToTrip, CalendarButton, LocationMap, ShareButton, TicketComparison, ViewTracker } from "@/components/event-detail-client";
import { Footer } from "@/components/footer";
import type { EventView } from "@/lib/types";
import { sellerSearches } from "@/lib/sellers";

export const dynamic = "force-dynamic";
type P = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const { slug } = await params;
  await ensureFresh();
  const e = getEventView(slug);
  if (!e) return { title: "Event not found" };
  const when = formatEventDate(e.start, e.timeZone);
  const desc = `${e.title} at ${e.venue.name}, ${e.venue.city}, on ${when}. ${e.isFree ? "Free entry." : "Compare ticket options and go to the official seller."}`;
  return {
    title: `${e.title}, ${e.venue.city}`,
    description: desc,
    alternates: { canonical: `/events/${e.slug}` },
    // Fictional demo pages must never be indexed as if they were real events.
    robots: e.provenance.isDemo ? { index: false, follow: false } : undefined,
    openGraph: { title: e.title, description: desc, images: e.imageUrl ? [e.imageUrl] : undefined, type: "website" },
  };
}

function jsonLd(e: EventView) {
  const statusMap: Record<string, string> = {
    cancelled: "https://schema.org/EventCancelled",
    postponed: "https://schema.org/EventPostponed",
    rescheduled: "https://schema.org/EventRescheduled",
  };
  return {
    "@context": "https://schema.org",
    "@type": groupOf(e.categorySlug) === "sports" ? "SportsEvent" : groupOf(e.categorySlug) === "music" ? "MusicEvent" : "Event",
    name: e.title,
    startDate: e.start,
    endDate: e.end,
    eventStatus: statusMap[e.status] ?? "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    image: e.imageUrl ? [e.imageUrl] : undefined,
    description: e.description,
    location: {
      "@type": "Place",
      name: e.venue.name,
      address: { "@type": "PostalAddress", streetAddress: e.venue.address, addressLocality: e.venue.city, addressCountry: e.venue.countryCode },
      geo: { "@type": "GeoCoordinates", latitude: e.venue.lat, longitude: e.venue.lng },
    },
    performer: e.people.map((p) => ({ "@type": p.kind === "team" ? "SportsTeam" : "PerformingGroup", name: p.name })),
    offers: e.offers
      .filter((o) => o.basePrice != null && o.purchaseUrl?.startsWith("http"))
      .map((o) => ({ "@type": "Offer", price: o.totalPrice ?? o.basePrice, priceCurrency: o.currency, url: o.purchaseUrl, seller: { "@type": "Organization", name: o.provider } })),
  };
}

const ROLE_LABEL: Record<string, string> = {
  headliner: "Headliner", support: "Support", artist: "Artist", team_home: "Home", team_away: "Away", team: "Team", athlete: "Athlete",
  speaker: "Speaker", performer: "Performer", cast: "Cast", organizer: "Organiser", competitor: "Competitor", dj: "DJ",
};

export default async function EventPage({ params }: { params: P }) {
  const { slug } = await params;
  await ensureFresh();
  const e = getEventView(slug);
  if (!e) notFound();
  const cat = getCategory(e.categorySlug);
  const group = groupOf(e.categorySlug);
  const v = e.venue;
  const sellers = e.provenance.isDemo ? [] : sellerSearches(v.countryCode, e.title, v.city, e.offers.map((o) => o.provider));
  const sameVenue = searchEvents({ venue: v.slug, pageSize: 6 }).items.filter((c) => c.id !== e.id).slice(0, 5);
  const nearby = searchEvents({ near: { lat: v.lat, lng: v.lng, radiusKm: 15 }, pageSize: 8, sort: "date" }).items.filter((c) => c.id !== e.id && c.venueSlug !== v.slug).slice(0, 5);
  const isDaily = e.eventType === "daily_attraction";
  const ymd = (iso: string) => iso.slice(0, 10);
  const teams = e.people.filter((p) => p.role === "team_home" || p.role === "team_away" || p.role === "team");
  const inactive = e.status === "cancelled" || e.status === "completed";

  return (
    <>
      <ViewTracker id={e.id} />
      {!e.provenance.isDemo && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(e)).replace(/</g, "\\u003c") }} />}
      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-6">
        <nav aria-label="Breadcrumb" className="t-small text-text-3 mb-4 flex flex-wrap gap-1">
          <Link href="/events" className="hover:text-text">Events</Link>
          <span aria-hidden>/</span>
          <Link href={`/categories/${group}`} className="hover:text-text">{getCategory(group)?.name}</Link>
          {v.cityId && (
            <>
              <span aria-hidden>/</span>
              <Link href={`/destinations/${v.cityId}`} className="hover:text-text">{v.city}</Link>
            </>
          )}
        </nav>

        {e.provenance.isDemo && (
          <div className="mb-5">
            <Notice tone="demo">
              <strong className="text-text">This is a fictional demo event.</strong> The venue, performers and ticket offers are invented to show how OMNIEVENT works. Real events appear once a data provider is connected.
            </Notice>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          <article className="min-w-0">
            <div className="relative overflow-hidden rounded-[var(--radius-l)] border border-line">
              <Poster title={e.title} imageUrl={e.imageUrl} hue={e.posterHue} categorySlug={e.categorySlug} size="lg" className="aspect-[21/9] w-full" />
            </div>

            <header className="mt-6">
              <div className="flex flex-wrap items-center gap-2 t-small text-text-2">
                <CategoryIcon slug={e.categorySlug} size={15} />
                <span>
                  <Link href={`/categories/${group}?sub=${e.categorySlug}`} className="hover:text-text">{cat?.name}</Link>
                  {e.sports?.competition && `, ${e.sports.competition}${e.sports.stage ? `, ${e.sports.stage}` : ""}`}
                </span>
                <StatusBadge status={e.status} />
                {e.provenance.isDemo && <DemoBadge />}
              </div>
              <h1 className="t-display mt-2 text-balance">{e.title}</h1>
              {teams.length === 2 && (
                <p className="t-h2 text-text-2 mt-2 font-normal">
                  <Link href={`/participants/${teams[0].slug}`} className="text-text hover:text-cyan">{teams[0].name}</Link>
                  <span className="mx-2 text-text-3">vs</span>
                  <Link href={`/participants/${teams[1].slug}`} className="text-text hover:text-cyan">{teams[1].name}</Link>
                </p>
              )}
            </header>

            {(e.status === "postponed" || e.status === "rescheduled" || e.status === "cancelled") && (
              <div role="status" className={`mt-5 flex gap-3 rounded-[var(--radius-m)] border p-4 ${e.status === "cancelled" ? "border-bad/40 bg-bad/5" : "border-warn/40 bg-warn/5"}`}>
                <TriangleAlert size={18} className={e.status === "cancelled" ? "text-bad" : "text-warn"} aria-hidden />
                <div className="t-small">
                  <p className="font-semibold">{e.status === "cancelled" ? "This event has been cancelled" : e.status === "postponed" ? "This event has been postponed" : "This event has a new date"}</p>
                  {e.rescheduledFrom && <p className="text-text-2">Originally {formatEventDate(e.rescheduledFrom, e.timeZone)}.</p>}
                  {e.statusNote && <p className="text-text-2 mt-0.5">{e.statusNote}</p>}
                </div>
              </div>
            )}

            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="flex gap-3">
                <Clock size={18} className="text-text-3 mt-0.5 shrink-0" aria-hidden />
                <div>
                  <dt className="t-micro text-text-3">{isDaily ? "Opening" : "Date and local time"}</dt>
                  <dd className="tnum">
                    {isDaily ? (
                      <>Open daily, until {formatEventDate(e.end!, e.timeZone)}</>
                    ) : (
                      <>
                        {formatEventDate(e.start, e.timeZone)}
                        {e.hoursUnknown ? (
                          <span className="block text-text-2">Times not listed by the source, see the official page</span>
                        ) : <span className="block">
                          {formatEventTime(e.start, e.timeZone)}
                          {e.end && e.eventType !== "multi_day" && <> to {formatEventTime(e.end, e.timeZone)}</>}{" "}
                          <span className="text-text-3">{tzAbbrev(e.start, e.timeZone)} ({e.timeZone.replace("_", " ")})</span>
                        </span>}
                        {e.eventType === "multi_day" && e.end && <span className="block text-text-2">Runs until {formatEventDate(e.end, e.timeZone)}</span>}
                      </>
                    )}
                    {e.durationMinutes && !isDaily && e.eventType !== "multi_day" && <span className="block t-small text-text-3">About {Math.round(e.durationMinutes / 15) * 15 >= 60 ? `${(Math.round(e.durationMinutes / 15) * 15) / 60} hours` : `${e.durationMinutes} minutes`}</span>}
                  </dd>
                </div>
              </div>
              <div className="flex gap-3">
                <MapPin size={18} className="text-text-3 mt-0.5 shrink-0" aria-hidden />
                <div>
                  <dt className="t-micro text-text-3">Venue</dt>
                  <dd>
                    <Link href={`/venues/${v.slug}`} className="hover:text-cyan">{v.name}</Link>
                    <span className="block text-text-2 t-small">{[v.address, v.city, v.country].filter(Boolean).join(", ")}</span>
                  </dd>
                </div>
              </div>
            </dl>

            {e.description && (
              <section className="mt-8" aria-labelledby="about">
                <h2 id="about" className="t-h2">About</h2>
                <div className="t-body text-text-2 mt-2 measure whitespace-pre-line">{e.description}</div>
              </section>
            )}

            {(e.schedule?.length || e.timeSlots?.length) && (
              <section className="mt-8" aria-labelledby="sched">
                <h2 id="sched" className="t-h2">{e.timeSlots ? "Entry times" : "More performances"}</h2>
                {e.timeSlots && <p className="t-small text-text-3 mt-1">Today&apos;s timed-entry slots as reported by the seller.</p>}
                <ul className="mt-3 flex flex-wrap gap-2">
                  {(e.timeSlots ?? e.schedule!.map((s) => ({ start: s, availability: "unknown" as const }))).map((s) => (
                    <li key={s.start} className={`rounded-[var(--radius-s)] border px-3 py-2 t-small tnum ${s.availability === "sold_out" ? "border-line text-text-3 line-through" : "border-line-strong"}`}>
                      {e.timeSlots ? formatEventTime(s.start, e.timeZone) : `${formatEventDate(s.start, e.timeZone)}, ${formatEventTime(s.start, e.timeZone)}`}
                      {s.availability === "limited" && <span className="text-warn"> limited</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {e.people.length > 0 && (
              <section className="mt-8" aria-labelledby="people">
                <h2 id="people" className="t-h2 flex items-center gap-2"><Users size={18} className="text-text-3" aria-hidden />{group === "sports" ? "Competitors" : group === "conferences" || group === "technology" ? "Speakers" : group === "theatre" ? "Cast" : "Line-up"}</h2>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {e.people.map((p) => (
                    <li key={p.id}>
                      <Link href={`/participants/${p.slug}`} className="flex items-center gap-3 rounded-[var(--radius-m)] border border-line p-3 hover:border-line-strong">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-panel-2 text-sm font-semibold text-text-2" aria-hidden>{p.name.replace(/^The /, "").slice(0, 1)}</span>
                        <span className="min-w-0">
                          <span className="block font-medium truncate">{p.name}</span>
                          <span className="block t-micro text-text-3">{ROLE_LABEL[p.role] ?? p.role}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section id="tickets" className="mt-10 scroll-mt-24" aria-labelledby="tix">
              <h2 id="tix" className="t-h2">Tickets</h2>
              <p className="t-small text-text-2 mt-1 mb-4">{ACCESS_META[e.ticketAccess]}{e.registrationRequired ? ". Register with the organiser before attending." : ""}</p>
              {e.ticketAccess === "free" ? (
                <p className="t-body">Entry is free. No ticket is needed unless the organiser says otherwise.</p>
              ) : (
                <TicketComparison offers={e.offers} eventStatus={e.status} />
              )}
              {e.ticketAccess !== "free" && sellers.length > 0 && (
                <div className="mt-5 rounded-[var(--radius-m)] border border-line bg-panel p-4">
                  <h3 className="t-small font-semibold">Compare on other ticket sites in {v.country}</h3>
                  <p className="t-micro text-text-3 mt-0.5">These open each seller&apos;s own search for this event. We haven&apos;t checked whether they sell it, or at what price.</p>
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {sellers.map((s) => (
                      <li key={s.id}>
                        <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center justify-between gap-2 rounded-[var(--radius-s)] border border-line-strong px-3 py-2 hover:border-cyan/50 hover:bg-panel-2">
                          <span className="font-medium text-sm">Search {s.name}</span>
                          <ExternalLink size={14} className="text-text-3" aria-hidden />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="mt-10 grid gap-6 sm:grid-cols-2" aria-label="Good to know">
              <div>
                <h2 className="t-h3 flex items-center gap-2"><ShieldCheck size={16} className="text-text-3" aria-hidden />Age policy</h2>
                <p className="t-small text-text-2 mt-1.5">{e.ageRestriction?.note ?? "No age restriction has been published. Check with the venue."}</p>
              </div>
              <div>
                <h2 className="t-h3 flex items-center gap-2"><Accessibility size={16} className="text-text-3" aria-hidden />Accessibility</h2>
                {e.accessibility?.length || v.accessibility?.length ? (
                  <ul className="t-small text-text-2 mt-1.5 list-disc pl-4">
                    {(e.accessibility ?? v.accessibility)!.map((a) => <li key={a}>{a}</li>)}
                  </ul>
                ) : (
                  <p className="t-small text-text-2 mt-1.5">No accessibility information has been published. Contact the venue for details.</p>
                )}
              </div>
            </section>

            <section className="mt-10" aria-labelledby="loc">
              <h2 id="loc" className="t-h2">Location</h2>
              <div className="mt-3">
                <LocationMap lat={v.lat} lng={v.lng} label={v.name} group={group} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <a className="btn btn-secondary btn-sm" href={`https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`} target="_blank" rel="noopener noreferrer">
                  <Navigation size={14} aria-hidden /> Directions
                </a>
                {v.url && (
                  <a className="btn btn-secondary btn-sm" href={v.url} target="_blank" rel="noopener noreferrer">
                    <Globe2 size={14} aria-hidden /> Venue website
                  </a>
                )}
                <span className="t-micro text-text-3 self-center tnum">{v.lat.toFixed(4)}, {v.lng.toFixed(4)}</span>
              </div>
            </section>

            <section className="mt-10" aria-labelledby="travel">
              <h2 id="travel" className="t-h2">Getting there</h2>
              <p className="t-small text-text-2 mt-1">These open searches on other sites. We don&apos;t check availability or prices.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a className="btn btn-secondary btn-sm" target="_blank" rel="noopener noreferrer" href={`https://www.booking.com/searchresults.html?ss=${encodeURIComponent(`${v.city}, ${v.country}`)}&checkin=${ymd(e.start)}`}>
                  <Hotel size={14} aria-hidden /> Stays in {v.city}
                </a>
                <a className="btn btn-secondary btn-sm" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/travel/flights?q=${encodeURIComponent(`flights to ${v.city} on ${ymd(e.start)}`)}`}>
                  <Plane size={14} aria-hidden /> Flights to {v.city}
                </a>
              </div>
            </section>

            {(sameVenue.length > 0 || nearby.length > 0) && (
              <div className="mt-12 grid gap-8 md:grid-cols-2">
                {sameVenue.length > 0 && (
                  <section aria-labelledby="same">
                    <h2 id="same" className="t-h3">Also at {v.name}</h2>
                    <ul className="divide-y divide-line mt-2">{sameVenue.map((c) => <EventRow key={c.id} c={c} />)}</ul>
                  </section>
                )}
                {nearby.length > 0 && (
                  <section aria-labelledby="near">
                    <h2 id="near" className="t-h3">Nearby</h2>
                    <ul className="divide-y divide-line mt-2">{nearby.map((c) => <EventRow key={c.id} c={c} />)}</ul>
                  </section>
                )}
              </div>
            )}
          </article>

          <aside className="lg:sticky lg:top-[calc(var(--header-h)+1.5rem)] self-start grid gap-4">
            <div className="surface rounded-[var(--radius-l)] p-5">
              <p className="t-micro text-text-3">{e.isFree ? "Entry" : "Tickets"}</p>
              <p className="t-h2 mt-1">
                <Price amount={e.fromPrice?.amount} currency={e.fromPrice?.currency} feesIncluded={e.fromPrice?.feesIncluded} isFree={e.isFree} />
              </p>
              {!e.isFree && e.offers.length > 0 && (
                <p className="t-small text-text-2 mt-1">{e.offers.length} offers from {new Set(e.offers.map((o) => o.provider)).size} sellers</p>
              )}
              <div className="mt-4 grid gap-2">
                {!e.isFree && e.offers.length > 0 && (
                  <a href="#tickets" className={`btn ${inactive ? "btn-secondary" : "btn-primary"} w-full`}>Compare ticket options</a>
                )}
                {e.officialUrl && (
                  <a href={e.officialUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary w-full">Official event page</a>
                )}
                <div className="flex flex-wrap gap-2">
                  <SaveButton id={e.id} title={e.title} />
                  <AddToTrip eventId={e.id} />
                  <ShareButton title={e.title} />
                  <CalendarButton slug={e.slug} />
                </div>
              </div>
            </div>
            <div className="rounded-[var(--radius-l)] border border-line p-4 t-small">
              <p className="flex items-center gap-2 font-semibold"><Database size={15} className="text-text-3" aria-hidden />Where this comes from</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-text-2">
                <dt className="text-text-3">Source</dt>
                <dd>{e.provenance.provider === "demo" ? "Demo generator (fictional)" : e.provenance.provider}</dd>
                <dt className="text-text-3">Synced</dt>
                <dd className="tnum">{relativeTime(e.provenance.lastSyncedAt)}</dd>
                {e.provenance.lastVerifiedAt && (
                  <>
                    <dt className="text-text-3">Verified</dt>
                    <dd className="tnum">{relativeTime(e.provenance.lastVerifiedAt)}</dd>
                  </>
                )}
                {e.provenance.sourceUrl && (
                  <>
                    <dt className="text-text-3">Listing</dt>
                    <dd><a href={e.provenance.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-text">Original page</a></dd>
                  </>
                )}
              </dl>
              {Date.now() - new Date(e.provenance.lastSyncedAt).getTime() > 2 * 86400000 && (
                <p className="text-warn mt-2">This information is more than two days old and may be out of date.</p>
              )}
            </div>
          </aside>
        </div>
      </main>
      <Footer />
    </>
  );
}
