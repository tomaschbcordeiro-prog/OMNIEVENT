import type { Metadata } from "next";
import { SITE } from "@/lib/site";
import Link from "next/link";
import { notFound } from "next/navigation";
import { preconnect } from "react-dom";
import { Clock, MapPin, Users, ShieldCheck, Accessibility, Navigation, Globe2, Hotel, Plane, TriangleAlert, Database, ExternalLink } from "lucide-react";
import { ensureFresh, getEventView, loadingNow, refreshSource, searchEvents, waitFor } from "@/lib/store";
import { formatEventDate, formatEventTime, formatShortDate, tzAbbrev, relativeTime, localDateKey } from "@/lib/format";
import { getCategory, groupOf, GROUP_HEX } from "@/lib/categories";
import { thumb } from "@/lib/thumb";
import { EventTile } from "@/components/event-card";
import { CategoryIcon, DemoBadge, HeroImage, Price, SaveButton, StatusBadge, Notice } from "@/components/ui";
import { TripButton } from "@/components/trips/trip-add";
import { CalendarButton, LocationMap, ShareButton, TicketComparison, ViewTracker } from "@/components/event-detail-client";
import { Footer } from "@/components/footer";
import { EventPoster } from "@/components/event-poster";
import { ShareToClub } from "@/components/clubs/share-to-club";
import type { EventView } from "@/lib/types";
import { sellerSearches } from "@/lib/sellers";
import { CommunityPanel } from "@/components/community/community-panel";
import { CommunityPulse } from "@/components/community/pulse";
import { EventActionBar } from "@/components/event-action-bar";
import { ListedBy } from "@/components/create/my-events";
import { Countdown } from "@/components/countdown";
import { DayForecast } from "@/components/weather";
import { TileStrip } from "@/components/tile-strip";
import { KeepExploring } from "@/components/keep-exploring";
import { TrailPager } from "@/components/event-trail";
import { TicketStamp } from "@/components/ticket";
import { snapOf } from "@/lib/after-event";

// Event pages are the same for everyone: each is kept ready (on the network edge) and
// rebuilt at most every ten minutes, so it opens at once. None is built ahead of time.
export const revalidate = 600;
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}
type P = Promise<{ slug: string }>;

/** An event a member just listed may not have reached this server yet: read the listings again once. */
async function findEvent(slug: string) {
  const e = getEventView(slug);
  if (e) return e;
  if (/-ue[a-z0-9]{8}$/.test(slug)) {
    await refreshSource("members").catch(() => {});
    return getEventView(slug);
  }
  // A server that has just started may still be loading the event's source.
  const late = await waitFor(() => getEventView(slug));
  // Still loading: fail this once (not kept) rather than keep a "not found" page for minutes.
  if (!late && loadingNow()) throw new Error("Events are still loading on this server. Try again in a moment.");
  return late;
}

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const { slug } = await params;
  await ensureFresh();
  const e = await findEvent(slug);
  // Not found here already, so the answer carries a real 404 (search engines drop the address).
  if (!e) notFound();
  const when = formatEventDate(e.start, e.timeZone);
  const desc = `${e.title} at ${e.venue.name}, ${e.venue.city}, on ${when}. ${e.isFree ? "Free entry." : "Compare ticket options and go to the official seller."}`;
  return {
    title: `${e.title}, ${e.venue.city}`,
    description: desc,
    alternates: { canonical: `/events/${e.slug}` },
    // Fictional demo pages must never be indexed as if they were real events.
    robots: e.provenance.isDemo ? { index: false, follow: false } : undefined,
    // Without a photo of its own, a drawn card (date, title, place) shows when the link is shared.
    openGraph: { title: e.title, description: desc, images: e.imageUrl ? [e.imageUrl] : [{ url: `/api/events/${e.slug}/card`, width: 1200, height: 630, alt: `${e.title}, ${when}` }], type: "website" },
    twitter: { card: "summary_large_image", title: e.title, description: desc, images: [e.imageUrl ?? `/api/events/${e.slug}/card`] },
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
    url: `${SITE}/events/${e.slug}`,
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
    performer: e.people.length ? e.people.map((p) => ({ "@type": p.kind === "team" ? "SportsTeam" : "PerformingGroup", name: p.name })) : undefined,
    organizer: e.listedBy ? { "@type": "Organization", name: e.listedBy.organiser, url: e.listedBy.organiserUrl } : undefined,
    isAccessibleForFree: e.isFree || undefined,
    offers: e.offers
      .filter((o) => o.basePrice != null && o.purchaseUrl?.startsWith("http"))
      .map((o) => ({
        "@type": "Offer",
        price: o.totalPrice ?? o.basePrice,
        priceCurrency: o.currency,
        url: o.purchaseUrl,
        availability: o.availability === "sold_out" || e.status === "sold_out" ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
        seller: { "@type": "Organization", name: o.provider },
      })),
  };
}

const ROLE_LABEL: Record<string, string> = {
  headliner: "Headliner", support: "Support", artist: "Artist", team_home: "Home", team_away: "Away", team: "Team", athlete: "Athlete",
  speaker: "Speaker", performer: "Performer", cast: "Cast", organizer: "Organiser", competitor: "Competitor", dj: "DJ",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "About 2 hours", "About 1.5 hours", "About 45 minutes". */
function aboutDuration(min: number): string {
  const q = Math.round(min / 15) * 15;
  if (q < 60) return `About ${Math.max(5, Math.round(min / 5) * 5)} minutes`;
  const h = q / 60;
  return `About ${h} ${h === 1 ? "hour" : "hours"}`;
}

export default async function EventPage({ params }: { params: P }) {
  const { slug } = await params;
  await ensureFresh();
  const e = await findEvent(slug);
  if (!e) notFound();
  // The page's main picture usually lives on another site: open that connection right away.
  if (e.imageUrl && /^https:\/\//.test(e.imageUrl)) preconnect(new URL(e.imageUrl).origin);
  const cat = getCategory(e.categorySlug);
  const group = groupOf(e.categorySlug);
  const v = e.venue;
  const sellerNames = [...new Set(e.offers.map((o) => o.provider))];
  const sellers = e.provenance.isDemo ? [] : sellerSearches(v.countryCode, e.title, v.city, e.offers.map((o) => o.provider));
  const sameVenue = searchEvents({ venue: v.slug, pageSize: 9 }).items.filter((c) => c.id !== e.id).slice(0, 8);
  const nearby = searchEvents({ near: { lat: v.lat, lng: v.lng, radiusKm: 15 }, pageSize: 14, sort: "date" }).items.filter((c) => c.id !== e.id && c.venueSlug !== v.slug).slice(0, 8);
  // The main performer's other dates elsewhere: a tour's other cities, a team's other matches.
  const lead = e.people.find((p) => p.role === "headliner") ?? e.people[0];
  const moreDates = lead ? searchEvents({ participant: lead.slug, pageSize: 12, sort: "date" }).items.filter((c) => c.id !== e.id && c.venueSlug !== v.slug).slice(0, 8) : [];
  // The same kind of thing in the same city, not already shown above.
  const shown = new Set([e.id, ...sameVenue.map((c) => c.id), ...moreDates.map((c) => c.id)]);
  const similar = v.cityId ? searchEvents({ city: v.cityId, categories: [e.categorySlug], pageSize: 16, sort: "date" }).items.filter((c) => !shown.has(c.id)).slice(0, 8) : [];
  for (const c of similar) shown.add(c.id);
  const nearbyNew = nearby.filter((c) => !shown.has(c.id));
  const isDaily = e.eventType === "daily_attraction";
  // An end time is worth showing only when it's after the start.
  const showEnd = !!e.end && e.eventType !== "multi_day" && Date.parse(e.end) - Date.parse(e.start) >= 15 * 60000;
  // The forecast for the day of the event, when it's in the week ahead (asked for by the browser).
  const daysAhead = (Date.parse(e.start) - Date.now()) / 864e5;
  const wxDate = !e.online && !isDaily && e.eventType !== "multi_day" && daysAhead > -0.5 && daysAhead < 6.5 ? localDateKey(e.start, e.timeZone) : null;
  const access = e.accessibility?.length ? e.accessibility : v.accessibility ?? [];
  const ymd = (iso: string) => iso.slice(0, 10);
  const teams = e.people.filter((p) => p.role === "team_home" || p.role === "team_away" || p.role === "team");
  const inactive = e.status === "cancelled" || e.status === "completed";
  // The page takes its light from the event: its picture's colours, else its category's.
  const accent = GROUP_HEX[group] ?? GROUP_HEX.other;
  // The small copy event lists show, so coming from a list it's already loaded (and it's too
  // small to ever count as the page's main picture).
  const ambient = e.imageUrl ? thumb(e.imageUrl, 64) : undefined;
  const stub = formatShortDate(e.start, e.timeZone);
  // Kept with the event when it's saved, so it can still be shown (and asked about) once it's over.
  const snap = snapOf({ slug: e.slug, title: e.title, start: e.start, timeZone: e.timeZone, eventType: e.eventType, hoursUnknown: e.hoursUnknown, venueName: v.name, venueSlug: v.slug, imageUrl: e.imageUrl, posterHue: e.posterHue, categorySlug: e.categorySlug });
  // What a trip keeps of it (online events go in no trip).
  const tripEvent = e.online ? undefined : { id: e.id, ...snap, lat: v.lat, lng: v.lng, city: v.city, cityId: v.cityId, countryCode: v.countryCode, groupSlug: group, until: e.end && Date.parse(e.end) - Date.parse(e.start) > 86_400_000 ? e.end : undefined };

  return (
    <>
      <ViewTracker id={e.id} />
      {!e.provenance.isDemo && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(e)).replace(/</g, "\\u003c") }} />}
      <div className="event-ambient" aria-hidden style={{ "--ink": accent } as React.CSSProperties}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {ambient && <img src={ambient} alt="" decoding="async" referrerPolicy="no-referrer" />}
      </div>
      <main className="relative z-[1] mx-auto max-w-[1400px] px-4 sm:px-6 pt-6">
        <div className="trail-row mb-4">
          <nav aria-label="Breadcrumb" className="trail-crumbs t-small text-text-3 flex flex-wrap gap-1">
            <Link href="/events" className="inline-block py-1 hover:text-text">Events</Link>
            <span aria-hidden>/</span>
            <Link href={`/categories/${group}`} className="inline-block py-1 hover:text-text">{getCategory(group)?.name}</Link>
            {v.cityId && (
              <>
                <span aria-hidden>/</span>
                <Link href={`/destinations/${v.cityId}`} className="inline-block py-1 hover:text-text">{v.city}</Link>
              </>
            )}
          </nav>
          <TrailPager slug={e.slug} />
        </div>

        {e.provenance.isDemo && (
          <div className="mb-5">
            <Notice tone="demo">
              <strong className="text-text">This is a fictional demo event.</strong> The venue, performers and ticket offers are invented to show how OMNIEVENT works. Real events appear once a data provider is connected.
            </Notice>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <article className="min-w-0">
            {/* The picture tapped in a list grows into this one (view transition "event-hero"). */}
            <div data-event-hero className="event-hero relative overflow-hidden rounded-[var(--radius-l)] border border-line">
              {/* A real picture gets room, shown whole; without one, a short band keeps the title near the top. */}
              {e.imageUrl ? (
                <HeroImage src={e.imageUrl} title={e.title} hue={e.posterHue} categorySlug={e.categorySlug} />
              ) : (
                <EventPoster e={e} />
              )}
            </div>

            <header className="mt-6">
              <div className="flex flex-wrap items-center gap-2 t-small text-text-2">
                <CategoryIcon slug={e.categorySlug} size={15} />
                <span>
                  <Link href={`/categories/${group}?sub=${e.categorySlug}`} className="hover:text-text">{cat?.name}</Link>
                  {e.sports?.competition && `, ${e.sports.competition}${e.sports.stage ? `, ${e.sports.stage}` : ""}`}
                </span>
                <StatusBadge status={e.status} quiet />
                {e.provenance.isDemo && <DemoBadge />}
              </div>
              <h1 className="t-display mt-2 text-balance">{e.title}</h1>
              {e.tagline && <p className="t-lede text-text-2 mt-2 measure">{e.tagline}</p>}
              {e.listedBy && <ListedBy id={e.provenance.externalId} ownerId={e.listedBy.id} name={e.listedBy.name} username={e.listedBy.username} organiser={e.listedBy.organiser} organiserUrl={e.listedBy.organiserUrl} />}
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
              <div className="relative pl-[30px]">
                <dt className="t-micro text-text-3">
                  <Clock size={18} className="absolute left-0 top-0.5 text-text-3" aria-hidden />
                  {isDaily ? "Opening" : "Date and local time"}
                </dt>
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
                        {showEnd && <> to {formatEventTime(e.end!, e.timeZone)}</>}{" "}
                        <span className="text-text-3">{tzAbbrev(e.start, e.timeZone)}</span>
                      </span>}
                      {e.eventType === "multi_day" && e.end && <span className="block text-text-2">Runs until {formatEventDate(e.end, e.timeZone)}</span>}
                    </>
                  )}
                  {!isDaily && !e.hoursUnknown && (
                    <span className="mt-1.5 block">
                      <Countdown starts={[e.start, ...(e.schedule ?? [])]} durationMinutes={e.durationMinutes} end={e.eventType === "multi_day" ? e.end : undefined} />
                    </span>
                  )}
                  {wxDate && <DayForecast lat={e.venue.lat} lng={e.venue.lng} date={wxDate} />}
                  {/* The length, when the end time isn't shown already. */}
                  {e.durationMinutes && !showEnd && !e.hoursUnknown && !isDaily && e.eventType !== "multi_day" && <span className="block t-small text-text-3">{aboutDuration(e.durationMinutes)}</span>}
                </dd>
              </div>
              <div className="relative pl-[30px]">
                <dt className="t-micro text-text-3">
                  <MapPin size={18} className="absolute left-0 top-0.5 text-text-3" aria-hidden />
                  Venue
                </dt>
                <dd>
                  <Link href={`/venues/${v.slug}`} className="hover:text-cyan">{v.name}</Link>
                  <span className="block text-text-2 t-small">{[v.address, v.city, v.country].filter(Boolean).join(", ")}</span>
                </dd>
              </div>
            </dl>

            {e.description && (
              <section className="reveal mt-8" aria-labelledby="about">
                <h2 id="about" className="t-h2">About</h2>
                <div className="t-body text-text-2 mt-2 measure whitespace-pre-line">{e.description}</div>
              </section>
            )}

            {e.programme && e.programme.length > 0 && (
              <section className="reveal mt-8" aria-labelledby="prog">
                <h2 id="prog" className="t-h2">Programme</h2>
                <ol className="mt-3 relative grid gap-3 border-l-2 border-line pl-5 ml-1.5">
                  {e.programme.map((p) => (
                    <li key={`${p.time}-${p.title}`} className="relative">
                      <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-panel bg-cyan" aria-hidden />
                      <span className="tnum font-semibold">{p.time}</span>
                      <span className="text-text-2"> · {p.title}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {(e.schedule?.length || e.timeSlots?.length) && (
              <section className="reveal mt-8" aria-labelledby="sched">
                <h2 id="sched" className="t-h2">{e.timeSlots ? "Entry times" : "More performances"}</h2>
                {e.timeSlots && <p className="t-small text-text-3 mt-1">Today&apos;s timed-entry slots as reported by the seller.</p>}
                {e.timeSlots ? (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {e.timeSlots.map((s) => (
                      <li key={s.start} className={`rounded-[var(--radius-s)] border px-3 py-2 t-small tnum ${s.availability === "sold_out" ? "border-line text-text-3 line-through" : "border-line-strong"}`}>
                        {formatEventTime(s.start, e.timeZone)}
                        {s.availability === "limited" && <span className="text-warn"> limited</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ScheduleCalendar dates={e.schedule!} timeZone={e.timeZone} hoursUnknown={e.hoursUnknown} />
                )}
              </section>
            )}

            {e.people.length > 0 && (
              <section className="reveal mt-8" aria-labelledby="people">
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

            <section id="tickets" className="reveal mt-10 scroll-mt-24" aria-labelledby="tix">
              <h2 id="tix" className="t-h2 mb-4">Tickets</h2>
              {(e.registrationRequired || e.ticketAccess === "registration") && <p className="t-small text-text-2 -mt-2 mb-4">Register with the organiser before you go.</p>}
              {e.ticketAccess === "free" ? (
                <p className="t-body">Entry is free. No ticket is needed unless the organiser says otherwise.</p>
              ) : (
                <TicketComparison offers={e.offers} eventStatus={e.status} />
              )}
              {e.ticketAccess !== "free" && sellers.length > 0 && !e.listedBy && (
                <div className="mt-4 flex flex-wrap items-center gap-2 t-small">
                  <span className="text-text-3" title="Each opens that site's own search for this event; we haven't checked whether they sell it, or at what price.">Also search on</span>
                  {sellers.map((s) => (
                    <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="chip press hover:border-cyan/50">
                      {s.name} <ExternalLink size={12} className="text-text-3" aria-hidden />
                    </a>
                  ))}
                </div>
              )}
            </section>

            <CommunityPanel target={`e:${e.id}`} mode={Date.parse(e.end ?? e.start) + (e.end ? 0 : (e.durationMinutes ?? 180) * 60000) < Date.now() ? "event-past" : "event-upcoming"} title={e.title} />

            {/* Only what the source actually says: no blocks of "nothing published". */}
            {(e.ageRestriction?.note || access.length > 0) && (
              <section className="reveal mt-10 grid gap-6 sm:grid-cols-2" aria-label="Good to know">
                {e.ageRestriction?.note && (
                  <div>
                    <h2 className="t-h3 flex items-center gap-2"><ShieldCheck size={16} className="text-text-3" aria-hidden />Age policy</h2>
                    <p className="t-small text-text-2 mt-1.5">{e.ageRestriction.note}</p>
                  </div>
                )}
                {access.length > 0 && (
                  <div>
                    <h2 className="t-h3 flex items-center gap-2"><Accessibility size={16} className="text-text-3" aria-hidden />Accessibility</h2>
                    <ul className="t-small text-text-2 mt-1.5 list-disc pl-4">
                      {access.map((a) => <li key={a}>{a}</li>)}
                    </ul>
                  </div>
                )}
              </section>
            )}

            <section className="reveal mt-10" aria-labelledby="loc">
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
                {/* Coming from elsewhere: searches on other sites (we don't check availability or prices). */}
                <a className="btn btn-ghost btn-sm" target="_blank" rel="noopener noreferrer" title="Opens a search on Booking.com" href={`https://www.booking.com/searchresults.html?ss=${encodeURIComponent(`${v.city}, ${v.country}`)}&checkin=${ymd(e.start)}`}>
                  <Hotel size={14} aria-hidden /> Stays in {v.city}
                </a>
                <a className="btn btn-ghost btn-sm" target="_blank" rel="noopener noreferrer" title="Opens a search on Google Flights" href={`https://www.google.com/travel/flights?q=${encodeURIComponent(`flights to ${v.city} on ${ymd(e.start)}`)}`}>
                  <Plane size={14} aria-hidden /> Flights
                </a>
              </div>
            </section>

            {(sameVenue.length > 0 || nearbyNew.length > 0 || moreDates.length > 0 || similar.length > 0) && (
              <div className="mt-12 grid gap-10">
                {lead && moreDates.length > 0 && (
                  <section aria-labelledby="more-dates">
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 id="more-dates" className="t-h3">More dates: {lead.name}</h2>
                      <Link href={`/participants/${lead.slug}`} className="see-all t-small text-text-2 hover:text-text shrink-0">All dates →</Link>
                    </div>
                    <TileStrip label={`More dates: ${lead.name}`}>{moreDates.map((c) => <EventTile key={c.id} c={c} />)}</TileStrip>
                  </section>
                )}
                {sameVenue.length > 0 && (
                  <section aria-labelledby="same">
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 id="same" className="t-h3">Also at {v.name}</h2>
                      <Link href={`/venues/${v.slug}`} className="see-all t-small text-text-2 hover:text-text shrink-0">All dates →</Link>
                    </div>
                    <TileStrip label={`Also at ${v.name}`}>{sameVenue.map((c) => <EventTile key={c.id} c={c} />)}</TileStrip>
                  </section>
                )}
                {similar.length > 0 && cat && (
                  <section aria-labelledby="similar">
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 id="similar" className="t-h3">More {cat.name.toLowerCase()} in {v.city}</h2>
                      <Link href={`/events?city=${v.cityId}&cat=${e.categorySlug}`} className="see-all t-small text-text-2 hover:text-text shrink-0">See all →</Link>
                    </div>
                    <TileStrip label={`More ${cat.name.toLowerCase()} in ${v.city}`}>{similar.map((c) => <EventTile key={c.id} c={c} />)}</TileStrip>
                  </section>
                )}
                {nearbyNew.length > 0 && (
                  <section aria-labelledby="near">
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 id="near" className="t-h3">Nearby, soon</h2>
                      {v.cityId && <Link href={`/events?city=${v.cityId}`} className="see-all t-small text-text-2 hover:text-text shrink-0">All of {v.city} →</Link>}
                    </div>
                    <TileStrip label="Nearby, soon">{nearbyNew.map((c) => <EventTile key={c.id} c={c} />)}</TileStrip>
                  </section>
                )}
              </div>
            )}
            <KeepExploring
              links={[
                v.cityId && cat ? { href: `/events?city=${v.cityId}&cat=${e.categorySlug}`, label: `${cat.name} in ${v.city}` } : null,
                { href: `/venues/${v.slug}`, label: `Everything at ${v.name}` },
                lead ? { href: `/participants/${lead.slug}`, label: `${lead.name}: all dates` } : null,
                v.cityId ? { href: `/destinations/${v.cityId}`, label: `${v.city} city guide` } : null,
                { href: `/categories/${group}`, label: `${getCategory(group)?.name ?? "This category"} worldwide` },
                v.cityId ? { href: `/mixtape?c=${v.cityId}`, label: `Plan a weekend in ${v.city}` } : null,
              ]}
            />
          </article>

          <section className="lg:sticky lg:top-[calc(var(--header-h)+1.5rem)] self-start grid gap-4">
            <div className="ticket-wrap" style={{ "--ink": accent } as React.CSSProperties}>
            <div className="ticket">
            <div className="p-5">
              <p className="t-micro text-text-3">{e.isFree ? "Entry" : "Tickets"}</p>
              {!e.isFree && e.fromPrice?.amount == null ? (
                // No price published: say where it is rather than that it's missing.
                <p className="t-h3 mt-1">Price on the seller&apos;s site</p>
              ) : (
                <p className="t-h2 mt-1">
                  <Price amount={e.fromPrice?.amount} currency={e.fromPrice?.currency} feesIncluded={e.fromPrice?.feesIncluded} isFree={e.isFree} />
                </p>
              )}
              {!e.isFree && e.offers.length > 0 && (
                <p className="t-small text-text-2 mt-1">
                  {sellerNames.length === 1 ? <>Sold by {sellerNames[0]}</> : <>{plural(e.offers.length, "offer")} from {plural(sellerNames.length, "seller")}</>}
                </p>
              )}
              <div className="mt-4 grid gap-2">
                {!e.isFree && e.offers.length > 0 && (
                  <a href="#tickets" className={`btn ${inactive ? "btn-secondary" : "btn-primary"} w-full`}>{e.offers.length > 1 ? `Compare ${e.offers.length} ticket options` : "Ticket options"}</a>
                )}
                {e.officialUrl && (
                  // With no offers to compare, the official page is the main way on.
                  <a href={e.officialUrl} target="_blank" rel="noopener noreferrer" className={`btn ${!inactive && (e.isFree || e.offers.length === 0) ? "btn-primary" : "btn-secondary"} w-full`}>
                    {e.isFree ? "Official page" : e.offers.length ? "Official event page" : "Tickets on the official page"} <ExternalLink size={14} aria-hidden />
                  </a>
                )}
                <CommunityPulse target={`e:${e.id}`} />
                <div className="flex flex-wrap gap-2">
                  <SaveButton id={e.id} title={e.title} snap={snap} />
                  {tripEvent && <TripButton variant="label" primary event={tripEvent} title={e.title} />}
                  <ShareButton title={e.title} />
                  <CalendarButton slug={e.slug} />
                  {!inactive && !e.provenance.isDemo && <ShareToClub eventId={e.id} title={e.title} />}
                </div>
              </div>
            </div>
            {/* The stub: when and where, as on a printed ticket. Saving stamps it. */}
            <div className="ticket-stub">
              {isDaily ? (
                <p className="ticket-date ticket-day--word">Daily</p>
              ) : (
                <p className="ticket-date">
                  <span className="ticket-day tnum">{stub.day}</span>
                  <span className="ticket-month">{stub.month}</span>
                </p>
              )}
              <div className="min-w-0">
                <p className="t-small font-semibold">
                  {isDaily ? "Open every day" : new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: e.timeZone }).format(new Date(e.start))}
                  {!isDaily && !e.hoursUnknown && <span className="tnum">, {formatEventTime(e.start, e.timeZone)}</span>}
                </p>
                <p className="t-small text-text-2 truncate">{v.name}</p>
              </div>
              <TicketStamp id={e.id} />
            </div>
            </div>
            </div>
            {/* Where it comes from, in one quiet line. */}
            <p className="px-1 t-micro text-text-3 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <Database size={12} aria-hidden />
              <span>{e.provenance.provider === "demo" ? "From the demo generator (fictional)" : e.listedBy ? "Listed by a member" : `From ${e.provenance.provider}`}</span>
              <span aria-hidden>·</span>
              <span className="tnum">updated {relativeTime(e.provenance.lastSyncedAt)}</span>
              {e.provenance.sourceUrl && (
                <>
                  <span aria-hidden>·</span>
                  <a href={e.provenance.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-text">original listing</a>
                </>
              )}
              {Date.now() - new Date(e.provenance.lastSyncedAt).getTime() > 2 * 86400000 && <span className="basis-full text-warn">More than two days old: it may be out of date.</span>}
            </p>
          </section>
        </div>
        <EventActionBar id={e.id} title={e.title} snap={snap} tripEvent={tripEvent} isFree={e.isFree} fromPrice={e.fromPrice} hasOffers={e.offers.length > 0} officialUrl={e.officialUrl} inactive={inactive} />
      </main>
      <Footer />
      {/* Room for the phone action bar, so it never covers the footer. */}
      <div className="h-20 lg:hidden" aria-hidden />
    </>
  );
}

/**
 * A run's other dates as a small calendar: one row of days per month, the time once when
 * every date shares it, and months after the first two folded away.
 */
function ScheduleCalendar({ dates, timeZone, hoursUnknown }: { dates: string[]; timeZone: string; hoursUnknown?: boolean }) {
  const months: { key: string; name: string; days: { iso: string; ymd: string }[] }[] = [];
  for (const iso of [...dates].sort()) {
    const ymd = localDateKey(iso, timeZone);
    const key = ymd.slice(0, 7);
    let m = months[months.length - 1];
    if (!m || m.key !== key) {
      const [y, mo] = key.split("-").map(Number);
      m = { key, name: new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }), days: [] };
      months.push(m);
    }
    m.days.push({ iso, ymd });
  }
  const times = new Set(dates.map((d) => formatEventTime(d, timeZone)));
  const oneTime = !hoursUnknown && times.size === 1 ? [...times][0] : null;
  const month = (m: (typeof months)[number]) => (
    <div key={m.key} className="sched-month">
      <h3 className="sched-month-name">
        {m.name} <span className="text-text-3 tnum">· {m.days.length} {m.days.length === 1 ? "date" : "dates"}</span>
      </h3>
      <ul className="sched-days">
        {m.days.map((d) => {
          const day = new Date(`${d.ymd}T12:00:00Z`);
          return (
            <li key={d.iso} className="sched-day" title={`${formatEventDate(d.iso, timeZone)}${hoursUnknown ? "" : `, ${formatEventTime(d.iso, timeZone)}`}`}>
              <span className="sched-wd">{day.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</span>
              <span className="sched-d tnum">{day.getUTCDate()}</span>
              {!oneTime && !hoursUnknown && <span className="sched-t tnum">{formatEventTime(d.iso, timeZone)}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
  const shown = months.slice(0, 2);
  const rest = months.slice(2);
  const restCount = rest.reduce((n, m) => n + m.days.length, 0);
  return (
    <div className="mt-3">
      <p className="t-small text-text-2 tnum">
        {dates.length} more {dates.length === 1 ? "date" : "dates"}
        {oneTime && <>, all at {oneTime}</>}
      </p>
      <div className="mt-2 grid gap-4">{shown.map(month)}</div>
      {rest.length > 0 && (
        <details className="sched-more mt-3">
          <summary className="btn btn-secondary btn-sm">Show {restCount} more {restCount === 1 ? "date" : "dates"}</summary>
          <div className="mt-4 grid gap-4">{rest.map(month)}</div>
        </details>
      )}
    </div>
  );
}
