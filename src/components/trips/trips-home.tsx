"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useUser } from "@/lib/user/store";
import { REGIONS } from "@/lib/trip";
import { TripPass } from "./shared";

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
    );
  return (
    <ul className="mt-8 grid gap-5 sm:grid-cols-2">
      {trips.map((t, i) => (
        <li key={t.id} className="trip-pass-item" style={{ "--i": i } as React.CSSProperties}>
          <Link href={`/trips/${t.id}`} className="block press" aria-label={`Open ${t.name}`}>
            <TripPass name={t.name} emoji={t.emoji} stops={t.stops ?? []} start={t.start} end={t.end} events={t.eventIds.length} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
