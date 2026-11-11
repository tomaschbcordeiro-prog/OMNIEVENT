"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus, Sparkles } from "lucide-react";
import type { EventCard } from "@/lib/types";
import { useUser, type Trip } from "@/lib/user/store";
import { KIND_ICON } from "./agenda";
import { codeOf, ideaGroups, REGIONS, routeFromEvents, type Place } from "@/lib/trip";
import { getDestination } from "@/lib/destinations";
import { localDateKey } from "@/lib/format";
import { TripPass } from "./shared";

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const range = (a: string, b: string) => (a === b ? fmt(a, { weekday: "short", day: "numeric", month: "short" }) : a.slice(0, 7) === b.slice(0, 7) ? `${fmt(a, { day: "numeric" })}–${fmt(b, { day: "numeric", month: "short" })}` : `${fmt(a, { day: "numeric", month: "short" })} – ${fmt(b, { day: "numeric", month: "short" })}`);

/**
 * Trips waiting in your saved events: saved events a few days apart (in one city or a few)
 * make a trip idea, planned in one tap with its cities, dates and events filled in.
 */
export function TripIdeas() {
  const user = useUser();
  const [cards, setCards] = useState<EventCard[] | null>(null);
  const inTrips = useMemo(() => new Set(user.trips.flatMap((t) => t.eventIds)), [user.trips]);
  const now = new Date().toISOString();
  // Saved events still to come (those saved with a date that has passed are left out).
  const ids = user.saved.filter((s) => !s.snap || s.snap.start >= now.slice(0, 10)).map((s) => s.id).filter((id) => !inTrips.has(id)).slice(0, 60);
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return setCards([]);
    const ctrl = new AbortController();
    fetch(`/api/events/batch?ids=${encodeURIComponent(key)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((j: { items: EventCard[] }) => setCards(j.items))
      .catch(() => {});
    return () => ctrl.abort();
  }, [key]);
  const ideas = useMemo(() => {
    // Each event's city as the planner will make it (the site's city it's in, or its own town).
    const placeOf = (c: EventCard): Place => {
      const city = c.cityId ? getDestination(c.cityId) : undefined;
      return city ? { name: city.name, lat: city.lat, lng: city.lng, cityId: city.id } : { name: c.city, lat: c.lat, lng: c.lng };
    };
    const evs = (cards ?? []).filter((c) => !c.online && c.start >= now.slice(0, 10) && c.eventType !== "daily_attraction").map((c) => ({ id: c.id, day: localDateKey(c.start, c.timeZone), lat: c.lat, lng: c.lng, place: placeOf(c) }));
    return ideaGroups(evs)
      .slice(0, 3)
      .map((g) => ({ ids: g.map((e) => e.id), cities: routeFromEvents(g)?.places.map((p) => p.name) ?? [], from: g[0].day, to: g[g.length - 1].day }));
    // `now` only matters by the day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);
  if (!ideas.length) return null;
  return (
    <section className="mt-8" aria-labelledby="ideas-h">
      <h2 id="ideas-h" className="t-small font-semibold flex items-center gap-1.5"><Sparkles size={15} className="text-sun" aria-hidden /> Trips in your saved events</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {ideas.map((d) => (
          <li key={d.ids.join()}>
            <Link href={`/trips/new?events=${d.ids.join(",")}`} className="trip-idea press">
              <span className="trip-idea-route">{d.cities.map((c) => codeOf(c)).join(" → ")}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold truncate">{d.cities.join(" → ")}</span>
                <span className="block t-micro text-text-2 tnum">{range(d.from, d.to)} · {d.ids.length} saved events</span>
              </span>
              <span className="trip-idea-go">Plan it <ArrowRight size={14} aria-hidden /></span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Your trips as boarding passes, and the way to plan the next one. */
export function TripsHome() {
  return (
    <main className="mx-auto max-w-[1100px] px-4 sm:px-6 pt-8 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-display">Trips</h1>
          <p className="t-lede text-text-2 mt-2 measure">Cities, countries, dates, and the events you want on the way, all on the globe.</p>
        </div>
        <Link href="/trips/new" className="btn btn-primary press"><Plus size={16} aria-hidden /> Plan a trip</Link>
      </div>
      <TripsList />
      <p className="t-micro text-text-3 mt-8">Trips are kept in this browser.</p>
    </main>
  );
}

/** What's next on a trip of yours: the first of your plans still to come. */
function NextPlan({ trip }: { trip: Trip }) {
  const now = new Date().toISOString().slice(0, 10);
  const next = [...(trip.plans ?? [])].filter((p) => p.day >= now).sort((a, b) => `${a.day}${a.time ?? "99"}`.localeCompare(`${b.day}${b.time ?? "99"}`))[0];
  if (!next) return null;
  const Icon = KIND_ICON[next.kind];
  return (
    <Link href={`/trips/${trip.id}`} className="trip-next" data-kind={next.kind}>
      <Icon size={14} aria-hidden className="shrink-0" />
      <span className="truncate"><b>Next:</b> {next.title}</span>
      <span className="tnum shrink-0 text-text-3">{fmt(next.day, { weekday: "short", day: "numeric", month: "short" })}{next.time ? ` · ${next.time}` : ""}</span>
    </Link>
  );
}

/** The trips as passes (soonest first), or ready-made routes to start from. */
export function TripsList() {
  const user = useUser();
  // Trips live in this browser: shown once it has been read.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const trips = mounted ? [...user.trips].sort((a, b) => (a.start ?? "9999").localeCompare(b.start ?? "9999")) : [];
  if (!mounted) return <div className="mt-8 grid gap-4 sm:grid-cols-2">{[0, 1].map((i) => <div key={i} className="skeleton h-40 rounded-[var(--radius-l)]" />)}</div>;
  if (!trips.length)
    return (
      <>
      <TripIdeas />
      <div className="trips-empty mt-8">
        <p className="t-h2">Where to next?</p>
        <p className="t-body text-text-2 mt-1">Start from a route and change it as you like.</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {REGIONS.map((r) => (
            <li key={r.id}>
              <Link href={`/trips/new?region=${r.id}`} className="chip chip-link press"><span aria-hidden>{r.emoji}</span> {r.name}</Link>
            </li>
          ))}
        </ul>
      </div>
      </>
    );
  return (
    <>
    <TripIdeas />
    <ul className="mt-8 grid gap-5 sm:grid-cols-2">
      {trips.map((t, i) => (
        <li key={t.id} className="trip-pass-item" style={{ "--i": i } as React.CSSProperties}>
          <Link href={`/trips/${t.id}`} className="block press" aria-label={`Open ${t.name}`}>
            <TripPass name={t.name} emoji={t.emoji} stops={t.stops ?? []} start={t.start} end={t.end} events={t.eventIds.length} />
          </Link>
          <NextPlan trip={t} />
        </li>
      ))}
    </ul>
    </>
  );
}
