"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plane } from "lucide-react";
import { useUser, type Trip } from "@/lib/user/store";
import { haversineKm } from "@/lib/geo";
import { STOP_RADIUS_KM, stopColor, type TripStop } from "@/lib/trip";
import { activeTripOf, rememberTrip } from "./trip-add";

/*
 * Ways from the rest of the site back into your trips: the cities of the trip you're planning
 * as one-tap searches on the events list, and a note on a city's page when it's on a trip.
 */

const RADIUS_KM = 30;
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
function range(from: string, to: string): string {
  if (from.slice(0, 7) === to.slice(0, 7)) return `${fmt(from, { day: "numeric" })}–${fmt(to, { day: "numeric", month: "short" })}`;
  return `${fmt(from, { day: "numeric", month: "short" })} – ${fmt(to, { day: "numeric", month: "short" })}`;
}

/** Everything on near a stop while you're there. */
export function stopSearch(s: TripStop): string {
  const p = new URLSearchParams({ lat: s.lat.toFixed(4), lng: s.lng.toFixed(4), radius: String(RADIUS_KM), pl: s.name, from: s.from, to: s.to });
  return `/events?${p}`;
}

const today = () => new Date().toISOString().slice(0, 10);

/** The trip being planned, read once in the browser (it lives in this browser only). */
function useActiveTrip(): Trip | undefined {
  const user = useUser();
  const [trip, setTrip] = useState<Trip>();
  useEffect(() => {
    const t = activeTripOf(user.trips.filter((x) => x.stops?.length && (!x.end || x.end >= today())));
    setTrip(t);
  }, [user.trips]);
  return trip;
}

/**
 * The events list: the stops of the trip you're planning, each a search of what's on there
 * while you're there; the one being looked at stays lit.
 */
export function TripStopsBar({ label, from }: { label?: string; from?: string }) {
  const trip = useActiveTrip();
  if (!trip?.stops?.length) return null;
  return (
    <nav className="trip-stops-bar panel-in" aria-label={`Your trip ${trip.name}`}>
      <Link href={`/trips/${trip.id}`} className="trip-stops-name" onClick={() => rememberTrip(trip.id)}>
        <span aria-hidden>{trip.emoji ?? "✈️"}</span>
        <span className="truncate">{trip.name}</span>
      </Link>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {trip.stops.map((s, i) => {
          const on = label?.split(",")[0] === s.name && from === s.from;
          return (
            <Link key={s.id} href={stopSearch(s)} className="chip shrink-0" aria-current={on ? "page" : undefined} style={{ "--ink": stopColor(i) } as React.CSSProperties}>
              <span className="trip-stop-dot" aria-hidden />
              {s.name} <span className="text-text-3 tnum">{range(s.from, s.to)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** A city's page: when it's on one of your trips, when you'll be there and what's on then. */
export function TripCallout({ name, lat, lng, cityId }: { name: string; lat: number; lng: number; cityId?: string }) {
  const user = useUser();
  const [hits, setHits] = useState<{ trip: Trip; stop: TripStop; i: number }[]>([]);
  useEffect(() => {
    const now = today();
    setHits(
      user.trips
        .filter((t) => !t.end || t.end >= now)
        .flatMap((trip) => {
          const i = trip.stops?.findIndex((s) => (cityId && s.cityId === cityId) || haversineKm(s.lat, s.lng, lat, lng) <= STOP_RADIUS_KM) ?? -1;
          return i >= 0 ? [{ trip, stop: trip.stops![i], i }] : [];
        })
        .slice(0, 2),
    );
  }, [user.trips, lat, lng, cityId]);
  if (!hits.length) return null;
  return (
    <div className="grid gap-2 mt-4">
      {hits.map(({ trip, stop, i }) => (
        <div key={trip.id} className="trip-callout panel-in" style={{ "--ink": stopColor(i) } as React.CSSProperties}>
          <span className="trip-callout-emoji" aria-hidden>{trip.emoji ?? "✈️"}</span>
          <div className="min-w-0 flex-1">
            <p className="t-small font-semibold">You&apos;re in {name} on {trip.name}</p>
            <p className="t-micro text-text-2 tnum">{range(stop.from, stop.to)} · {trip.eventIds.length} {trip.eventIds.length === 1 ? "event" : "events"} planned on the trip</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Link href={stopSearch(stop)} className="btn btn-primary btn-sm press">What&apos;s on those days</Link>
            <Link href={`/trips/${trip.id}`} className="btn btn-secondary btn-sm press" onClick={() => rememberTrip(trip.id)}>
              <Plane size={14} aria-hidden /> Open trip
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
