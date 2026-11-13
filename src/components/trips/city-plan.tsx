"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Landmark, MapPin, Plus } from "lucide-react";
import type { EventCard } from "@/lib/types";
import { userActions, type Trip } from "@/lib/user/store";
import { daysOf, flagOf, nightsBetween, placeName, STOP_RADIUS_KM, stopColor, type TripStop } from "@/lib/trip";
import { haversineKm } from "@/lib/geo";
import { isScheduled, isTravel, type PlanKind, type TripPlan } from "@/lib/trip-plans";
import { POI_COLOR, poiGroup, poiLabel } from "@/lib/pois";
import type { Sight } from "@/lib/sights";
import { formatEventTime, localDateKey } from "@/lib/format";
import type { TripEvent } from "@/lib/trip-snap";
import { Poster } from "../ui";
import { toast } from "../toast";
import { announcePlan, PLAN_DRAG, TripAgenda } from "./agenda";
import { pickingFor, planFor, sightDraft, useSights, type Picking } from "./add-sheet";
import { openAdd } from "./add-bus";
import { AddBar } from "./add-bar";

/*
 * A city of a trip, as one page of everything you're going to do there: what's planned day
 * by day, the places you want to see, its best-known sights to add in a tap, one search for
 * anything (a museum, a restaurant, "dinner 20:30"), and what's on while you're there.
 */

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const dayName = (d: string) => fmt(d, { weekday: "short", day: "numeric", month: "short" });
/** The city's best-known sights, as cards with their picture: add one in a tap. */
function Sights({ trip, stop, sights, onShowAt, onPick, day }: { trip: Trip; stop: TripStop; sights: Sight[] | null; onShowAt: (lat: number, lng: number) => void; onPick: (p: Picking) => void; day: string | null }) {
  const rail = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const onScroll = () => {
    const r = rail.current;
    if (r) setEdge({ start: r.scrollLeft < 8, end: r.scrollLeft + r.clientWidth >= r.scrollWidth - 8 });
  };
  if (sights && !sights.length) return null;
  return (
    <section className="city-sights" aria-labelledby="city-sights-h">
      <div className="flex items-center justify-between gap-2">
        <h3 id="city-sights-h" className="city-h"><Landmark size={14} aria-hidden /> Top sights in {placeName(stop)}</h3>
        <span className="flex gap-1 max-sm:hidden">
          <button type="button" className="ag-icon-btn" aria-label="Earlier sights" disabled={edge.start} onClick={() => rail.current?.scrollBy({ left: -260, behavior: "smooth" })}><ChevronLeft size={16} aria-hidden /></button>
          <button type="button" className="ag-icon-btn" aria-label="More sights" disabled={edge.end} onClick={() => rail.current?.scrollBy({ left: 260, behavior: "smooth" })}><ChevronRight size={16} aria-hidden /></button>
        </span>
      </div>
      <ul ref={rail} className="city-sights-rail" onScroll={onScroll} tabIndex={0} aria-label={`Sights in ${placeName(stop)}`}>
        {sights === null
          ? [0, 1, 2].map((i) => <li key={i} className="sight-card skeleton" aria-hidden />)
          : sights.map((s) => {
              const on = planFor(trip, s.lat, s.lng, s.name);
              return (
                <li key={s.id} className="sight-card" data-on={on ? "" : undefined} style={{ "--k": POI_COLOR[poiGroup(s.cls)] } as React.CSSProperties}>
                  <button type="button" className="sight-pic" onClick={() => onShowAt(s.lat, s.lng)} aria-label={`Show ${s.name} on the globe`}>
                    {s.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.image} alt="" loading="lazy" />
                    ) : (
                      <span className="sight-pic-none" aria-hidden><Landmark size={22} /></span>
                    )}
                    <span className="sight-kind">{poiLabel(s.cls)}</span>
                  </button>
                  <div className="sight-body">
                    <p className="sight-name">{s.name}</p>
                    {s.about && <p className="sight-about">{s.about}</p>}
                    <div className="sight-actions">
                      <button
                        type="button"
                        className={`sight-add press ${on ? "is-on" : ""}`}
                        onClick={() => onPick(pickingFor(trip, sightDraft(s), day ? { day } : undefined))}
                        aria-label={on ? `${s.name} is on the trip${on.day ? `, ${dayName(on.day)}${on.time ? ` ${on.time}` : ""}` : ""}. Change when` : `Add ${s.name}`}
                      >
                        {on ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden />} {on ? (on.day ? `${fmt(on.day, { weekday: "short", day: "numeric" })}${on.time ? ` ${on.time}` : ""}` : "Added") : "Add"}
                      </button>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="sight-more" aria-label={`About ${s.name} (Wikipedia)`}>
                        <ExternalLink size={13} aria-hidden />
                      </a>
                    </div>
                  </div>
                </li>
              );
            })}
      </ul>
      <p className="t-micro text-text-3 mt-1">From Wikipedia. Zoom into the globe for every restaurant, café and shop.</p>
    </section>
  );
}

/** The plans of a city: on its days (but the journeys), or places to see round it. */
export function plansIn(trip: Trip, stop: TripStop): TripPlan[] {
  const days = daysOf(stop.from, stop.to);
  const near = (p: TripPlan) => p.lat != null && p.lng != null && haversineKm(p.lat, p.lng, stop.lat, stop.lng) <= STOP_RADIUS_KM;
  return (trip.plans ?? []).filter((p) => !isTravel(p.kind) && (isScheduled(p) ? days.includes(p.day) && (p.lat == null || near(p)) : near(p)));
}

/** What a kind of plan is counted as, in a city's summary. */
const BUCKET: Partial<Record<PlanKind, "see" | "meals" | "stay" | "other">> = { visit: "see", activity: "see", meal: "meals", stay: "stay", meeting: "other", note: "other" };

export function CityPlan({
  trip,
  stop,
  index,
  stops,
  dayEvents,
  ideas,
  eventsLink,
  onAdd,
  onOpen,
  onPickStop,
  onShowPlace,
  onShowAt,
}: {
  trip: Trip;
  stop: TripStop;
  index: number;
  stops: TripStop[];
  dayEvents: { e: TripEvent; day: string }[];
  ideas: EventCard[] | null;
  /** Everything on there those days, on the events page. */
  eventsLink: string;
  onAdd: (c: EventCard) => void;
  onOpen: (id: string) => void;
  onPickStop: (i: number) => void;
  onShowPlace: (p: TripPlan) => void;
  onShowAt: (lat: number, lng: number) => void;
}) {
  const days = useMemo(() => daysOf(stop.from, stop.to), [stop.from, stop.to]);
  const sights = useSights(stop);
  const [over, setOver] = useState<string | null>(null);
  const near = (p: TripPlan) => p.lat != null && p.lng != null && haversineKm(p.lat, p.lng, stop.lat, stop.lng) <= STOP_RADIUS_KM;
  const mine = plansIn(trip, stop);
  const events = dayEvents.filter((x) => days.includes(x.day));
  const count = (b: string) => mine.filter((p) => BUCKET[p.kind] === b).length;
  const stay = mine.find((p) => p.kind === "stay");
  const onDays = (trip.plans ?? []).filter((p) => isScheduled(p) && days.includes(p.day) && (p.lat == null || near(p)));
  const perDay = (d: string) => [...onDays.filter((p) => p.day === d).sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "")).map((p) => p.kind as string), ...events.filter((x) => x.day === d).map(() => "event")];
  const scrollTo = (sel: string) => document.querySelector<HTMLElement>(`.trip-panel ${sel}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  return (
    <div className="city" style={{ "--ink": stopColor(index) } as React.CSSProperties}>
      <div className="city-head">
        <p className="city-name">
          <span className="planner-stop-n" aria-hidden>{index + 1}</span> {stop.name} <span aria-hidden>{flagOf(stop.countryCode)}</span>
        </p>
        <p className="t-small text-text-2">
          {dayName(stop.from)} → {dayName(stop.to)}, {nightsBetween(stop.from, stop.to)} {nightsBetween(stop.from, stop.to) === 1 ? "night" : "nights"}
          {stop.place ? ` · ${stop.place}` : ""}
        </p>
        <div className="city-sum">
          <button type="button" className="city-sum-chip" onClick={() => scrollTo(".ag-days")}><b className="tnum">{events.length}</b> {events.length === 1 ? "event" : "events"}</button>
          <button type="button" className="city-sum-chip" onClick={() => (document.querySelector(".trip-panel .ag-tosee") ? scrollTo(".ag-tosee") : scrollTo(".city-sights"))}><b className="tnum">{count("see")}</b> to see &amp; do</button>
          <button type="button" className="city-sum-chip" onClick={() => scrollTo(".ag-days")}><b className="tnum">{count("meals")}</b> {count("meals") === 1 ? "meal" : "meals"}</button>
          <button type="button" className="city-sum-chip" data-warn={!stay || undefined} onClick={() => scrollTo(".ag-days")}>{stay ? <>Staying at <b>{stay.title}</b></> : "No bed yet"}</button>
        </div>
        <ol className="city-days" aria-label="Your days here">
          {days.map((d) => {
            const k = perDay(d);
            return (
              <li key={d}>
                <button
                  type="button"
                  className="city-day"
                  data-drop={over === d || undefined}
                  onClick={() => scrollTo(`.ag-day[data-day="${d}"]`)}
                  aria-label={`${dayName(d)}: ${k.length ? `${k.length} planned` : "free"}`}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(PLAN_DRAG)) return;
                    e.preventDefault();
                    setOver(d);
                  }}
                  onDragLeave={() => setOver((o) => (o === d ? null : o))}
                  onDrop={(e) => {
                    setOver(null);
                    const p = trip.plans?.find((x) => x.id === e.dataTransfer.getData(PLAN_DRAG));
                    if (!p) return;
                    e.preventDefault();
                    announcePlan(p.id, e.currentTarget.getBoundingClientRect());
                    userActions.updatePlan(trip.id, p.id, { day: d });
                    toast({ title: `${p.title}: ${dayName(d)}${p.time ? `, ${p.time}` : ""}`, emoji: "🗓️", action: { label: "Undo", run: () => userActions.updatePlan(trip.id, p.id, p) } });
                  }}
                >
                  <span className="city-day-wd">{fmt(d, { weekday: "short" })}</span>
                  <span className="city-day-n tnum">{fmt(d, { day: "numeric" })}</span>
                  <span className="city-day-dots" aria-hidden>
                    {k.length ? k.slice(0, 5).map((kind, i) => <i key={i} data-kind={kind === "event" ? "activity" : kind} />) : <span className="city-day-free">free</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <AddBar title={`Add to ${placeName(stop)}`} sub="A place, food, your hotel, a flight, a plan of your own" stopId={stop.id} />

      <Sights trip={trip} stop={stop} sights={sights} onShowAt={onShowAt} onPick={(p) => openAdd({ stopId: stop.id, picking: p })} day={null} />

      <h3 className="city-h mt-5"><MapPin size={14} aria-hidden /> Your plan in {placeName(stop)}</h3>
      <TripAgenda trip={trip} stops={stops} events={dayEvents} only={days} near={stop} compose={false} onAddOnDay={(d) => openAdd({ stopId: stop.id, day: d })} onOpenEvent={onOpen} onPickStop={onPickStop} onShowPlace={onShowPlace} />

      <h3 className="city-h mt-5">Events on while you&apos;re there</h3>
      {ideas === null ? (
        <div className="mt-2 grid gap-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14" />)}</div>
      ) : ideas.length ? (
        <ul className="mt-2 grid gap-1.5">
          {ideas.slice(0, 12).map((c) => (
            <li key={c.id} className="idea-row">
              <Poster title={c.title} imageUrl={c.imageUrl} hue={c.posterHue} categorySlug={c.categorySlug} size="sm" className="h-11 w-11 shrink-0 rounded-[var(--radius-s)]" />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(c.id)}>
                <span className="block font-semibold truncate">{c.title}</span>
                <span className="block t-micro text-text-3 truncate">{dayName(localDateKey(c.start, c.timeZone))}{c.hoursUnknown ? "" : `, ${formatEventTime(c.start, c.timeZone)}`}, {c.venueName}</span>
              </button>
              <button type="button" className="btn btn-secondary btn-icon btn-sm press" aria-label={`Add ${c.title} to the trip`} onClick={() => onAdd(c)}><Plus size={15} aria-hidden /></button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-small text-text-2 mt-2">Nothing listed there on those days yet{trip.interests?.length ? " for what you like" : ""}.</p>
      )}
      <Link href={eventsLink} className="see-all t-small text-text-2 hover:text-text mt-3">Everything on in {placeName(stop)} those days →</Link>
    </div>
  );
}
