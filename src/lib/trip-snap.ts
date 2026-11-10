/**
 * What a trip keeps of an event: enough to show it and place it on the globe after it has left
 * the catalogue. Light on purpose: every event card uses it.
 */
import type { EventCard } from "./types";
import type { TripEventSnap } from "./user/store";
import { localDateKey } from "./format";

export type TripEvent = TripEventSnap & { id: string };

export function tripSnapOf(c: EventCard): TripEvent {
  return {
    id: c.id,
    slug: c.slug,
    title: c.title.slice(0, 200),
    start: c.start,
    timeZone: c.timeZone,
    eventType: c.eventType,
    hoursUnknown: c.hoursUnknown || undefined,
    venueName: c.venueName.slice(0, 120),
    venueSlug: c.venueSlug,
    imageUrl: c.imageUrl,
    posterHue: c.posterHue,
    categorySlug: c.categorySlug,
    lat: c.lat,
    lng: c.lng,
    city: c.city,
    cityId: c.cityId,
    groupSlug: c.groupSlug,
    until: c.until,
  };
}

/**
 * An event's days, for fitting it into a trip: the day it starts and, for a run (an exhibition,
 * a festival) or a place open daily, the last day it can be caught.
 */
export function spanOf(e: Pick<TripEvent, "lat" | "lng" | "start" | "timeZone" | "until" | "eventType">): { lat: number; lng: number; day: string; until?: string } {
  return {
    lat: e.lat,
    lng: e.lng,
    day: localDateKey(e.start, e.timeZone),
    until: e.eventType === "daily_attraction" ? "9999-12-31" : e.until ? localDateKey(e.until, e.timeZone) : undefined,
  };
}
