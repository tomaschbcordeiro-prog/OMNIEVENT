"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BedDouble, CalendarDays, Check, Play, Plus, Sparkles, TrainFront, Users, Wallet, ListChecks, MessageCircle } from "lucide-react";
import type { EventCard } from "@/lib/types";
import { listProgress, moneySummary } from "@/lib/trip-share";
import { useRefreshShared } from "@/lib/group-sync";
import { useUser, type Trip } from "@/lib/user/store";
import { KIND_ICON } from "./agenda";
import { codeOf, ideaGroups, REGIONS, routeFromEvents, type Place } from "@/lib/trip";
import { getDestination } from "@/lib/destinations";
import { localDateKey } from "@/lib/format";
import { TripPass } from "./shared";
import { RouteSketch } from "./route-sketch";
import { phaseLabel, tripReady, type NextStep } from "@/lib/trip-ready";
import type { TripEvent } from "@/lib/trip-snap";

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
  const user = useUser();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // With no trips yet, the list itself offers the routes.
  const any = mounted && user.trips.length > 0;
  return (
    <main className="mx-auto max-w-[1200px] px-4 sm:px-6 pt-8 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-display">Trips</h1>
          <p className="t-lede text-text-2 mt-2 measure">Cities, countries, dates, and the events you want on the way, all on the globe.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/trips/join" className="btn btn-secondary press"><Users size={16} aria-hidden /> Join with a PIN</Link>
          <Link href="/trips/new" className="btn btn-primary press"><Plus size={16} aria-hidden /> Plan a trip</Link>
        </div>
      </div>
      <div className="trips-layout">
        <div className="min-w-0">
          <TripsList />
        </div>
        <aside className="trips-side" aria-label="Plan another trip">
          <Link href="/trips/ideas" className="trips-side-link press" data-kind="ideas">
            <span className="trips-side-icon" aria-hidden>✨</span>
            <span className="min-w-0">
              <span className="block font-semibold">Trip ideas</span>
              <span className="block t-micro text-text-2">Endless routes: coasts, mountains, wine, islands…</span>
            </span>
            <ArrowRight size={16} aria-hidden className="ml-auto shrink-0" />
          </Link>
          <Link href="/trips/shared" className="trips-side-link press mt-2 mb-5" data-kind="shared">
            <span className="trips-side-icon" aria-hidden>🧳</span>
            <span className="min-w-0">
              <span className="block font-semibold">From travellers</span>
              <span className="block t-micro text-text-2">Trips people shared. Share yours too.</span>
            </span>
            <ArrowRight size={16} aria-hidden className="ml-auto shrink-0" />
          </Link>
          {any && (
            <>
              <p className="t-small font-semibold">Or start from a region</p>
              <ul className="mt-3 mb-5 flex flex-wrap gap-2">
                {REGIONS.map((r) => (
                  <li key={r.id}>
                    <Link href={`/trips/new?region=${r.id}`} className="chip chip-link press"><span aria-hidden>{r.emoji}</span> {r.name}</Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="t-micro text-text-2 flex gap-2">
            <Sparkles size={14} className="shrink-0 text-sun mt-px" aria-hidden />
            <span>On any event, press <kbd className="kbd">T</kbd> or the suitcase to put it in a trip. It lands on the right day and city.</span>
          </p>
          <p className="t-micro text-text-3 mt-4">Trips are kept in this browser.</p>
        </aside>
      </div>
    </main>
  );
}

/** What's next on a trip of yours: the first of your plans still to come. */
function NextPlan({ trip, today }: { trip: Trip; today: string }) {
  const next = [...(trip.plans ?? [])].filter((p) => p.day >= today).sort((a, b) => `${a.day}${a.time ?? "99"}`.localeCompare(`${b.day}${b.time ?? "99"}`))[0];
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

/** One part of getting a trip ready (beds, journeys, days), as a count and a bar. */
function Meter({ Icon, label, more, have, need }: { Icon: typeof Plus; label: string; /** Said after the label where there's room. */ more?: string; have: number; need: number }) {
  if (!need) return null;
  const done = have >= need;
  return (
    <li className="trip-meter" data-done={done || undefined}>
      <span className="trip-meter-top">
        <Icon size={13} aria-hidden />
        <span className="tnum font-semibold">{done ? <Check size={13} aria-label="All set" /> : `${have}/${need}`}</span>
        <span className="leading-tight">{label}{more && <span> {more}</span>}</span>
      </span>
      <span className="trip-meter-bar" aria-hidden><span style={{ width: `${Math.round((have / need) * 100)}%` }} /></span>
    </li>
  );
}

/** Where the trip's "add next" takes you: the trip, its Add sheet open on the right thing. */
function nextHref(id: string, n: NextStep): string {
  if (n.kind === "stay") return `/trips/${id}?add=stay&stop=${n.stop.id}`;
  if (n.kind === "journey") return `/trips/${id}?add=${n.by}&leg=${n.leg}`;
  return `/trips/${id}?add=1&stop=${n.stop.id}&day=${n.day}`;
}
const NEXT_ICON: Record<NextStep["kind"], typeof Plus> = { stay: BedDouble, journey: TrainFront, day: CalendarDays };

/** A trip on the list: its pass with the route drawn small, how ready it is, and what to add next. */
function TripCard({ trip: t, i, today }: { trip: Trip; i: number; today: string }) {
  const stops = useMemo(() => t.stops ?? [], [t.stops]);
  const r = useMemo(() => {
    const ids = new Set(t.eventIds);
    const events = Object.entries(t.snaps ?? {})
      .filter(([id, e]) => ids.has(id) && e.start)
      .map(([id, e]) => ({ e: { ...e, id } as TripEvent, day: localDateKey(e.start, e.timeZone) }));
    return tripReady({ ...t, stops }, events, today);
  }, [t, stops, today]);
  const past = r.phase === "past";
  const NextIcon = r.next ? NEXT_ICON[r.next.kind] : Plus;
  return (
    <li className="trip-card" data-phase={r.phase} style={{ "--i": i } as React.CSSProperties}>
      <Link href={`/trips/${t.id}`} className="block press" aria-label={`Open ${t.name}`}>
        <TripPass
          name={t.name}
          emoji={t.emoji}
          stops={stops}
          start={t.start}
          end={t.end}
          events={t.eventIds.length}
          compact={past}
          tag={<><span className="trip-pass-tag-dot" aria-hidden />{phaseLabel(r)}{t.group && t.group.members.length > 1 ? ` · with ${t.group.members.filter((m) => m.id !== t.group!.me).map((m) => m.name).slice(0, 2).join(", ")}${t.group.members.length > 3 ? ` +${t.group.members.length - 3}` : ""}` : ""}</>}
          aside={stops.length > 0 ? <RouteSketch stops={stops} /> : undefined}
        />
      </Link>
      {!past && stops.length > 0 && (
        <div className="trip-ready">
          <ul className="trip-meters" aria-label={`Getting ${t.name} ready`}>
            <Meter Icon={BedDouble} label={r.beds.need === 1 ? "Bed" : "Beds"} {...r.beds} />
            <Meter Icon={TrainFront} label={r.journeys.need === 1 ? "Journey" : "Journeys"} {...r.journeys} />
            <Meter Icon={CalendarDays} label="Days" more="planned" {...r.planned} />
          </ul>
          {r.next && (
            <Link href={nextHref(t.id, r.next)} className="trip-ready-next press" data-kind={r.next.kind}>
              <span className="trip-ready-next-icon" aria-hidden><NextIcon size={15} /></span>
              <span className="min-w-0">
                <span className="block t-micro text-text-2">Add next</span>
                <span className="block font-semibold truncate">{r.next.label}</span>
              </span>
              <Plus size={16} aria-hidden className="ml-auto shrink-0" />
            </Link>
          )}
        </div>
      )}
      <TripFacts trip={t} />
      <div className="trip-card-actions">
        {stops.length > 0 && (
          <Link href={`/trips/${t.id}?show=1`} className="trip-pass-view press" aria-label={`View ${t.name} as a film`}>
            <span aria-hidden><Play size={10} fill="currentColor" /></span> Play trip
          </Link>
        )}
        {!past && (
          <Link href={`/trips/${t.id}?add=1`} className="trip-card-add press" aria-label={`Add to ${t.name}`}>
            <Plus size={14} aria-hidden /> Add
          </Link>
        )}
      </div>
      {!past && <NextPlan trip={t} today={today} />}
    </li>
  );
}

/** The trips as passes (soonest first, the ones behind you after), or ready-made routes to start from. */
export function TripsList() {
  const user = useUser();
  // Shared trips: the latest from the others, so each card says what's new.
  useRefreshShared(user.trips.filter((t) => t.group).map((t) => t.id));
  // Trips live in this browser: shown once it has been read.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const today = mounted ? localDateKey(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone) : "";
  const sorted = mounted ? [...user.trips].sort((a, b) => (a.start ?? "9999").localeCompare(b.start ?? "9999")) : [];
  const ahead = sorted.filter((t) => !t.end || t.end >= today);
  const behind = sorted.filter((t) => t.end && t.end < today).reverse();
  if (!mounted) return <div className="mt-8 grid gap-4">{[0, 1].map((i) => <div key={i} className="skeleton h-40 rounded-[var(--radius-l)]" />)}</div>;
  if (!sorted.length)
    return (
      <>
      <TripIdeas />
      <div className="trips-empty mt-8">
        <p className="t-h2">Where to next?</p>
        <p className="t-body text-text-2 mt-1">Start from a route and change it as you like, or browse <Link href="/trips/ideas" className="font-semibold underline">endless trip ideas</Link>.</p>
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
    {ahead.length > 0 && (
      <ul className="trip-cards mt-8">
        {ahead.map((t, i) => <TripCard key={t.id} trip={t} i={i} today={today} />)}
      </ul>
    )}
    {behind.length > 0 && (
      <section className="mt-10" aria-labelledby="trips-past-h">
        <h2 id="trips-past-h" className="t-small font-semibold text-text-2">Been there</h2>
        <ul className="trip-cards is-past mt-3">
          {behind.map((t, i) => <TripCard key={t.id} trip={t} i={i} today={today} />)}
        </ul>
      </section>
    )}
    </>
  );
}

/** The trip's money, lists and chat at a glance, each a shortcut to its tab. */
function TripFacts({ trip: t }: { trip: Trip }) {
  const money = (t.expenses?.length ?? 0) > 0 ? moneySummary({ expenses: t.expenses ?? [], currency: t.currency }) : null;
  const lists = listProgress(t.checklist ?? []);
  const g = t.group;
  const unread = g ? (t.messages ?? []).filter((m) => m.by !== g.me && (!g.lastRead || m.at > g.lastRead)).length : 0;
  if (!money && !lists.all && !unread) return null;
  const fmt = (n: number, cur: string) => {
    try {
      return new Intl.NumberFormat("en-GB", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${Math.round(n)} ${cur}`;
    }
  };
  return (
    <ul className="trip-facts" aria-label={`${t.name} at a glance`}>
      {money && (
        <li>
          <Link href={`/trips/${t.id}?tab=money`} className="trip-fact press" data-over={t.budget && money.total > t.budget ? "" : undefined}>
            <Wallet size={13} aria-hidden /> <span className="tnum">{fmt(money.total, money.currency)}{t.budget ? ` of ${fmt(t.budget, money.currency)}` : ""}</span>
          </Link>
        </li>
      )}
      {lists.all > 0 && (
        <li>
          <Link href={`/trips/${t.id}?tab=lists`} className="trip-fact press" data-done={lists.done === lists.all ? "" : undefined}>
            <ListChecks size={13} aria-hidden /> <span className="tnum">{lists.done}/{lists.all} ready</span>
          </Link>
        </li>
      )}
      {unread > 0 && (
        <li>
          <Link href={`/trips/${t.id}?chat=1`} className="trip-fact trip-fact-chat press">
            <MessageCircle size={13} aria-hidden /> <span className="tnum">{unread} new</span>
          </Link>
        </li>
      )}
    </ul>
  );
}
