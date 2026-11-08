import { SITE } from "./site";
import type { EventCard, Venue } from "./types";

/**
 * schema.org descriptions of venues and performers for search engines, with their upcoming
 * dates: what lets a search show "Upcoming events" under a venue or an artist.
 */

const PLACE_TYPE: Record<string, string> = {
  stadium: "StadiumOrArena",
  arena: "StadiumOrArena",
  park: "Park",
  museum: "Museum",
  theatre: "PerformingArtsTheater",
  theater: "PerformingArtsTheater",
  cinema: "MovieTheater",
  concert_hall: "MusicVenue",
  club: "NightClub",
  bar: "BarOrPub",
};

function eventStub(c: EventCard) {
  return {
    "@type": c.groupSlug === "sports" ? "SportsEvent" : c.groupSlug === "music" ? "MusicEvent" : "Event",
    name: c.title,
    startDate: c.start,
    url: `${SITE}/events/${c.slug}`,
    image: c.imageUrl ? [c.imageUrl] : undefined,
    eventStatus: c.status === "cancelled" ? "https://schema.org/EventCancelled" : c.status === "postponed" ? "https://schema.org/EventPostponed" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: { "@type": "Place", name: c.venueName, address: { "@type": "PostalAddress", addressLocality: c.city, addressCountry: c.country } },
  };
}

export function venueLd(v: Venue, events: EventCard[]) {
  return {
    "@context": "https://schema.org",
    "@type": PLACE_TYPE[v.venueType ?? ""] ?? "EventVenue",
    name: v.name,
    url: `${SITE}/venues/${v.slug}`,
    sameAs: v.url?.startsWith("http") ? [v.url] : undefined,
    address: { "@type": "PostalAddress", streetAddress: v.address, addressLocality: v.city, addressCountry: v.countryCode || v.country },
    geo: { "@type": "GeoCoordinates", latitude: v.lat, longitude: v.lng },
    maximumAttendeeCapacity: v.capacity,
    event: events.slice(0, 20).map(eventStub),
  };
}

export function performerLd(p: { name: string; slug: string; kind: string; url?: string; description?: string }, events: EventCard[]) {
  return {
    "@context": "https://schema.org",
    "@type": p.kind === "team" ? "SportsTeam" : p.kind === "athlete" || p.kind === "speaker" ? "Person" : p.kind === "organizer" ? "Organization" : "PerformingGroup",
    name: p.name,
    url: `${SITE}/participants/${p.slug}`,
    sameAs: p.url?.startsWith("http") ? [p.url] : undefined,
    description: p.description,
    event: events.slice(0, 20).map(eventStub),
  };
}

/** The JSON for a <script type="application/ld+json">, safe to put inside HTML. */
export function ldJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
