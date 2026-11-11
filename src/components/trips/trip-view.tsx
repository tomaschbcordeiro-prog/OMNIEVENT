"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Copy, Download, ExternalLink, Globe2, MapPin, Pencil, Plane, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import type { EventCard } from "@/lib/types";
import { userActions, useUser, type Trip } from "@/lib/user/store";
import { daysOf, fitSpan, flagOf, midpoint, nightsBetween, placeName, stopColor, type Fit, type TripStop } from "@/lib/trip";
import { isTravel, kindLabel, planIcs } from "@/lib/trip-plans";
import { KIND_ICON, TripAgenda } from "./agenda";
import { PoiCard, type MapPlace } from "./place-to-trip";
import type { MapClick } from "../earth/earth-map";
import type { TripPlan } from "@/lib/trip-plans";
import { spanOf } from "@/lib/trip-snap";
import { rememberTrip } from "./trip-add";
import { stopSearch } from "./trip-shortcuts";
import { formatEventTime, localDateKey } from "@/lib/format";
import type { EarthMapHandle, FlyRequest } from "../earth/earth-map";
import { Poster } from "../ui";
import { toast } from "../toast";
import { bboxOf, CityPin, dayLabel, fanOut, longRange, MapIcons, routeOf, SheetGrab, shortRange, TripGlobe, tripSnapOf, usePanelPad, useSheet, useTripEvents, type MapIcon, type TripEvent } from "./shared";

const GROUP_EMOJI: Record<string, string> = {
  music: "🎶", sports: "⚽", theatre: "🎭", comedy: "😂", festivals: "🎉", cinema: "🎬", conferences: "🎤", technology: "💻",
  exhibitions: "🎨", attractions: "🎡", "food-drink": "🍷", nightlife: "🪩", family: "🧸", outdoor: "🥾", education: "📚", fashion: "👗", culture: "🏛️",
};
const RADIUS_KM = 30;
const dayOf = (e: { start: string; timeZone: string }) => localDateKey(e.start, e.timeZone);

type Placed = { e: TripEvent; fit: Fit; day: string };
/** Where an event goes in a trip: its city, and the day it's down for (a run: the first day there). */
function placeIn(stops: TripStop[], e: TripEvent): Placed {
  const span = spanOf(e);
  const fit = fitSpan(stops, span);
  return { e, fit, day: fit.ok && span.day < fit.stop.from ? fit.stop.from : span.day };
}

/** Events on in each city of the trip on its days (for what the trip is into), nearest first. */
function useSuggestions(trip: Trip | undefined) {
  const [byStop, setByStop] = useState<Record<string, EventCard[] | null>>({});
  const sig = (trip?.stops ?? []).map((s) => `${s.id}:${s.lat}:${s.lng}:${s.from}:${s.to}`).join("|") + `|${trip?.interests?.join(",") ?? ""}`;
  useEffect(() => {
    if (!trip?.stops?.length) return;
    const ctrl = new AbortController();
    for (const s of trip.stops) {
      const p = new URLSearchParams({ lat: s.lat.toFixed(4), lng: s.lng.toFixed(4), radius: String(RADIUS_KM), from: s.from, to: s.to, size: "24", sort: "date" });
      if (trip.interests?.length) p.set("cat", trip.interests.join(","));
      setByStop((b) => ({ ...b, [s.id]: b[s.id] ?? null }));
      fetch(`/api/events?${p}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((j: { items: EventCard[] }) => setByStop((b) => ({ ...b, [s.id]: j.items.filter((c) => c.eventType !== "daily_attraction") })))
        .catch(() => {});
    }
    return () => ctrl.abort();
    // The signature covers the route, its dates and the vibe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return byStop;
}

/**
 * A trip on the globe. Its cities are pins; tap one and the globe glides there while the
 * events of your days there spring out of the pin: the ones in your trip solid, suggestions
 * dashed with a plus. Tap any of them for its card, and add or remove it in one tap.
 */
export function TripView({ id }: { id: string }) {
  const user = useUser();
  const router = useRouter();
  const sp = useSearchParams();
  const trip = user.trips.find((t) => t.id === id);
  const api = useRef<EarthMapHandle | null>(null);
  const sheet = useSheet("half");
  const pad = usePanelPad(sheet.panel);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  /** The whole trip as an agenda, day by day, or as its cities. */
  const [view, setView] = useState<"agenda" | "cities">("agenda");
  /** Event icons are out (after the glide to the city, so they spring from the pin). */
  const [burst, setBurst] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  /** A place tapped on the globe (a museum, a restaurant…), to put on the trip. */
  const [poi, setPoi] = useState<(MapPlace & { below?: boolean }) | null>(null);
  const [fly, setFly] = useState<FlyRequest>();
  const flyKey = useRef(0);
  const { events } = useTripEvents(trip);
  const sugg = useSuggestions(trip);
  const stops = useMemo(() => trip?.stops ?? [], [trip?.stops]);
  const stop = sel === null ? undefined : stops[sel];
  useEffect(() => setLoaded(true), []);
  // The trip open here is the one events go to from the rest of the site.
  useEffect(() => {
    if (trip) rememberTrip(trip.id);
  }, [trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each of the trip's events, with the city (and day) it belongs to, or why it doesn't fit.
  const placed = useMemo(() => events.map((e) => placeIn(stops, e)), [events, stops]);
  const inTrip = useMemo(() => new Set(events.map((e) => e.id)), [events]);
  const dayEvents = useMemo(() => placed.map((p) => ({ e: p.e, day: p.day })), [placed]);

  const frameAll = () => {
    const pts = stops.length ? stops : events;
    const bbox = bboxOf(pts);
    if (bbox && pts[0]) setFly({ key: ++flyKey.current, lat: pts[0].lat, lng: pts[0].lng, bbox, zoom: pts.length === 1 ? 9 : 7.5, padding: pad });
  };
  // The whole trip first, once the globe is up.
  const framed = useRef(false);
  useEffect(() => {
    if (!ready || framed.current || !trip) return;
    framed.current = true;
    frameAll();
    if (sp.get("hello")) {
      toast({ title: "Your trip is ready", body: "Tap a city to see what's on while you're there.", emoji: trip.emoji ?? "✈️" });
      router.replace(`/trips/${trip.id}`, { scroll: false });
    }
    // Once, when the globe is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, trip]);

  const pick = (i: number | null) => {
    setOpen(null);
    setBurst(false);
    setSel(i);
    // A phone shows the city's events on the globe and its days below, half and half.
    sheet.setSnap("half");
    if (i === null) return frameAll();
    const s = stops[i];
    // The city and everything about to spring out of it, framed in the part of the globe the
    // panel leaves free.
    const around = [s, ...placed.filter((p) => p.fit.ok && p.fit.stop.id === s.id).map((p) => p.e), ...(sugg[s.id] ?? []).slice(0, 18)];
    setFly({ key: ++flyKey.current, lat: s.lat, lng: s.lng, bbox: bboxOf(around, 0.012), zoom: 13.2, padding: pad });
    // The events come out once the globe has arrived.
    window.setTimeout(() => setBurst(true), 950);
  };

  // An event picked in the agenda: the globe goes to it and opens its card (a phone shows
  // half the globe for it).
  // The globe: a place (from the map) tapped shows its card; anywhere else closes cards.
  const tapGlobe = (c: MapClick) => {
    setOpen(null);
    if (c.feature?.poi && c.feature.name) {
      const at = api.current?.project([c.lng, c.lat]);
      setPoi({ name: c.feature.name, lat: c.lat, lng: c.lng, poi: c.feature.poi, below: !!at && at.y < 300 });
      // On a phone, the sheet folds so the card can be seen.
      sheet.setSnap("peek");
    } else setPoi(null);
  };
  // A plan with a place: the globe goes there; its pin on the globe finds it in the agenda.
  const showPlace = (p: TripPlan) => {
    if (p.lat == null || p.lng == null) return;
    setFly({ key: ++flyKey.current, lat: p.lat, lng: p.lng, zoom: 16.5, padding: pad });
    sheet.setSnap("half");
  };
  const findPlan = (p: TripPlan) => {
    if (sel !== null && !(p.day && stop && p.day >= stop.from && p.day <= stop.to)) setSel(null);
    setView("agenda");
    sheet.setSnap("half");
    window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`.trip-panel [data-plan="${p.id}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.remove("is-new");
      void el.offsetWidth;
      el.classList.add("is-new");
      window.setTimeout(() => el.classList.remove("is-new"), 1700);
    }, 120);
  };
  const showEvent = (eid: string) => {
    const e = events.find((x) => x.id === eid) ?? (sugg[stop?.id ?? ""] ?? []).find((x) => x.id === eid);
    if (e?.lat) setFly({ key: ++flyKey.current, lat: e.lat, lng: e.lng, zoom: 14, padding: pad });
    sheet.setSnap("half");
    setBurst(true);
    window.setTimeout(() => setOpen(eid), e?.lat ? 700 : 0);
  };
  const add = (c: EventCard) => {
    if (!trip) return;
    userActions.setTripEvent(trip.id, tripSnapOf(c), true);
    try {
      navigator.vibrate?.(10);
    } catch {
      // no vibration here
    }
    toast({ title: "Added to your trip", body: c.title, emoji: "📌", action: { label: "Undo", run: () => userActions.setTripEvent(trip.id, tripSnapOf(c), false) } });
  };
  const remove = (e: TripEvent) => {
    if (!trip) return;
    userActions.setTripEvent(trip.id, e, false);
    setOpen(null);
    toast({ title: "Taken out of your trip", body: e.title, emoji: "🗑️", action: { label: "Undo", run: () => userActions.setTripEvent(trip.id, e, true) } });
  };

  // ---- Icons on the globe ----------------------------------------------------------------
  const icons = useMemo<MapIcon[]>(() => {
    if (!trip) return [];
    const out: MapIcon[] = stops.map((s, i) => ({
      key: `stop-${s.id}`,
      lat: s.lat,
      lng: s.lng,
      anchor: "bottom",
      delay: loaded ? 0 : 200 + i * 140,
      node: <CityPin n={i + 1} name={s.name} color={stopColor(i)} active={sel === i} small={sel === i && burst} note={shortRange(s.from, s.to)} onClick={() => pick(sel === i ? null : i)} />,
    }));
    const show = (e: TripEvent | EventCard, saved: boolean, j: number, color: string) => {
      out.push({
        key: `ev-${e.id}`,
        lat: e.lat,
        lng: e.lng,
        from: stop ? { lat: stop.lat, lng: stop.lng } : undefined,
        delay: stop ? 60 + j * 45 : j * 25,
        node: (
          <EventIcon
            e={e}
            saved={saved}
            color={color}
            open={open === e.id}
            onToggle={() => setOpen((o) => (o === e.id ? null : e.id))}
            onAdd={() => add(e as EventCard)}
            onRemove={() => remove(e as TripEvent)}
          />
        ),
      });
    };
    if (stop && sel !== null && burst) {
      const mine = placed.filter((p) => p.fit.ok && p.fit.stop.id === stop.id).map((p) => p.e);
      mine.forEach((e, j) => show(e, true, j, stopColor(sel)));
      (sugg[stop.id] ?? []).filter((c) => !inTrip.has(c.id)).slice(0, 18).forEach((c, j) => show(c, false, mine.length + j, stopColor(sel)));
    } else if (sel === null) {
      // The whole trip: what's chosen, in each city's colour.
      placed.forEach((p, j) => show(p.e, true, j, p.fit.ok ? stopColor(stops.indexOf(p.fit.stop)) : "#6F819C"));
    }
    // How you get from city to city, when it's planned: its mark in the middle of the leg.
    stops.slice(1).forEach((b, j) => {
      const a = stops[j];
      const go = (trip.plans ?? []).find((pl) => isTravel(pl.kind) && pl.day === a.to);
      if (!go) return;
      const m = midpoint(a, b);
      const Icon = KIND_ICON[go.kind];
      out.push({ key: `stop-leg-${a.id}-${go.id}`, lat: m.lat, lng: m.lng, delay: 400, node: <span className="leg-mode" data-kind={go.kind} title={`${go.title}${go.time ? `, ${go.time}` : ""}`} aria-label={`${kindLabel(go.kind)} from ${a.name} to ${b.name}${go.time ? ` at ${go.time}` : ""}`} role="img"><Icon size={14} aria-hidden /></span> });
    });
    // Your places on the trip (from the map), each a pin in the colour of what it is.
    for (const p of trip.plans ?? []) {
      if (p.lat == null || p.lng == null) continue;
      const Icon = KIND_ICON[p.kind];
      out.push({ key: `plan-${p.id}`, lat: p.lat, lng: p.lng, delay: 120, node: <button type="button" className="plan-pin" data-kind={p.kind} onClick={(e) => (e.stopPropagation(), findPlan(p))} aria-label={`${p.title}${p.day ? `, ${dayLabel(p.day)}` : ", a place to see"}. Find it in the agenda`} title={p.title}><Icon size={13} aria-hidden /></button> });
    }
    // Events sharing a venue fan out round it (the city pins stay put).
    const cities = out.filter((ic) => ic.key.startsWith("stop-"));
    const project = (lat: number, lng: number) => api.current?.project([lng, lat]) ?? null;
    const card: MapIcon[] = poi ? [{ key: `poi:${poi.lat}:${poi.lng}`, lat: poi.lat, lng: poi.lng, anchor: poi.below ? "top" : "bottom", node: <PoiCard place={poi} tripId={trip.id} below={poi.below} onClose={() => setPoi(null)} /> }] : [];
    return [...cities, ...fanOut(out.filter((ic) => !ic.key.startsWith("stop-")), ready ? project : undefined), ...card];
    // pick/add/remove only read state that's listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip, stops, sel, stop, burst, placed, sugg, inTrip, open, loaded, ready, poi]);

  if (!trip) {
    return (
      <main className="mx-auto max-w-xl px-4 pt-20 text-center">
        <p className="t-h2">This trip isn&apos;t in this browser</p>
        <p className="t-body text-text-2 mt-2">Trips are kept on the device they were planned on.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/trips" className="btn btn-secondary">Your trips</Link>
          <Link href="/trips/new" className="btn btn-primary">Plan a trip</Link>
        </div>
      </main>
    );
  }

  const nights = trip.start && trip.end ? nightsBetween(trip.start, trip.end) : 0;
  const flags = [...new Set(stops.map((s) => flagOf(s.countryCode)).filter(Boolean))];
  const off = placed.filter((p) => !p.fit.ok);

  return (
    <div className="trip-stage">
      <TripGlobe api={api} route={routeOf(stops)} fly={fly} pad={pad} onReady={() => setReady(true)} onBackground={tapGlobe} label={`Globe with your trip ${trip.name}: tap a city to see its events; zoom in to see places (restaurants, museums…) and tap one to add it.`} />
      <MapIcons api={api} ready={ready} icons={icons} />

      <section
        ref={sheet.panel}
        className="planner-panel trip-panel"
        aria-label={trip.name}
        data-snap={sheet.snap}
        onFocusCapture={(e) => {
          if ((e.target as HTMLElement).matches("input:not([type=time]), textarea")) sheet.setSnap("full");
        }}
      >
        <SheetGrab snap={sheet.snap} grab={sheet.grab} label="Your trip" />
        <header className="planner-head">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="trip-title"><span aria-hidden>{trip.emoji ?? "✈️"}</span> {trip.name}</h1>
              <p className="t-small text-text-2 mt-0.5">
                {longRange(trip.start, trip.end)}{nights > 0 && `, ${nights} ${nights === 1 ? "night" : "nights"}`} {flags.length > 0 && <span aria-hidden className="ml-1 max-lg:hidden">{flags.join(" ")}</span>}
              </p>
            </div>
            <Link href="/trips" className="btn btn-ghost btn-icon btn-sm shrink-0" aria-label="All your trips"><X size={18} aria-hidden /></Link>
          </div>
          <div className="trip-chips" role="tablist" aria-label="Cities on this trip">
            <button type="button" role="tab" aria-selected={sel === null} className="trip-chip" onClick={() => pick(null)}>
              <Globe2 size={14} aria-hidden /> Whole trip
            </button>
            {stops.map((s, i) => (
              <button key={s.id} type="button" role="tab" aria-selected={sel === i} className="trip-chip" style={{ "--ink": stopColor(i) } as React.CSSProperties} onClick={() => pick(i)}>
                <span className="trip-chip-n" aria-hidden>{i + 1}</span> {s.name}
              </button>
            ))}
          </div>
        </header>

        <div className="planner-body" key={sel ?? "all"}>
          {!stops.length && (
            <div className="trip-empty">
              <p className="font-semibold">This trip has no route yet</p>
              <p className="t-small text-text-2 mt-1">Add its cities and dates to see it on the globe, with what&apos;s on in each place.</p>
              <Link href={`/trips/new?edit=${trip.id}`} className="btn btn-primary btn-sm mt-3"><Pencil size={14} aria-hidden /> Add the route</Link>
            </div>
          )}

          {sel === null && (stops.length > 0 || (trip.plans?.length ?? 0) > 0) && (
            <div className="seg" role="tablist" aria-label="Show the trip as">
              <button type="button" role="tab" aria-selected={view === "agenda"} className="seg-btn" onClick={() => setView("agenda")}>Agenda</button>
              <button type="button" role="tab" aria-selected={view === "cities"} className="seg-btn" onClick={() => setView("cities")}>Cities</button>
            </div>
          )}
          {sel === null && view === "agenda" && <TripAgenda trip={trip} stops={stops} events={dayEvents} onOpenEvent={showEvent} onPickStop={(i) => pick(i)} onShowPlace={showPlace} />}

          {sel === null &&
            view === "cities" &&
            stops.map((s, i) => {
              const mine = placed.filter((p) => p.fit.ok && p.fit.stop.id === s.id);
              const n = sugg[s.id];
              return (
                <button key={s.id} type="button" className="stop-card press" style={{ "--ink": stopColor(i) } as React.CSSProperties} onClick={() => pick(i)}>
                  <span className="planner-stop-n" aria-hidden>{i + 1}</span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block font-semibold">{s.name} <span aria-hidden>{flagOf(s.countryCode)}</span>{s.place && <span className="t-micro font-normal text-text-3"> · {s.place}</span>}</span>
                    <span className="block t-small text-text-2">{dayLabel(s.from)} → {dayLabel(s.to)}, {nightsBetween(s.from, s.to)} {nightsBetween(s.from, s.to) === 1 ? "night" : "nights"}</span>
                  </span>
                  <span className="stop-card-counts t-micro tnum">
                    <span><b>{mine.length}</b> planned</span>
                    <span className="text-text-3">{n == null ? "…" : n.filter((c) => !inTrip.has(c.id)).length} ideas</span>
                  </span>
                </button>
              );
            })}

          {sel === null && view === "cities" && stops.length > 0 && (
            <p className="trip-tip t-micro text-text-2">
              <span className="trip-tip-icon" aria-hidden><Plane size={12} /></span>
              <span>
                Add events from anywhere on OMNIEVENT: the plane button on any event puts it here, and on a computer you can drag events onto your trip.{" "}
                <Link href={stopSearch(stops[0])} className="font-semibold text-cyan hover:underline">Browse {placeName(stops[0])} →</Link>
              </span>
            </p>
          )}

          {stop && sel !== null && <StopPlan trip={trip} stop={stop} index={sel} stops={stops} dayEvents={dayEvents} ideas={(sugg[stop.id] ?? null)?.filter((c) => !inTrip.has(c.id)) ?? null} onAdd={add} onOpen={showEvent} onPickStop={(i) => pick(i)} onShowPlace={showPlace} />}

          {off.length > 0 && sel === null && (
            <section className="mt-5" aria-labelledby="off-h">
              <h2 id="off-h" className="t-small font-semibold flex items-center gap-1.5 text-warn"><TriangleAlert size={15} aria-hidden /> Not on your route</h2>
              <ul className="mt-2 grid gap-1.5">
                {off.map(({ e, fit }) => (
                  <li key={e.id} className="off-row">
                    <span className="min-w-0 flex-1">
                      <Link href={`/events/${e.slug}`} className="font-semibold hover:text-cyan block truncate">{e.title}</Link>
                      <span className="t-micro text-text-2">
                        {dayLabel(dayOf(e))}, {e.city}:{" "}
                        {!fit.ok && (fit.why === "before" ? "before your trip starts" : fit.why === "after" ? "after your trip ends" : fit.why === "wrong-days" ? `you're not in ${fit.stop?.name} that day` : "not near any city on your route")}
                      </span>
                    </span>
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Take ${e.title} out of the trip`} onClick={() => remove(e)}><X size={15} aria-hidden /></button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <footer className="planner-foot trip-actions">
          <Link href={`/trips/new?edit=${trip.id}`} className="btn btn-secondary btn-sm"><Pencil size={14} aria-hidden /> <span className="max-sm:sr-only">Edit route</span></Link>
          <ExportButtons trip={trip} events={events} />
          <button type="button" className="btn btn-ghost btn-icon btn-sm text-bad" aria-label="Delete this trip" onClick={() => {
            if (!confirm(`Delete “${trip.name}”?`)) return;
            userActions.deleteTrip(trip.id);
            router.push("/trips");
          }}><Trash2 size={15} aria-hidden /></button>
        </footer>
      </section>
    </div>
  );
}

/** An event on the globe: its kind as an emoji; solid when it's in the trip, dashed with a plus when it's an idea. */
function EventIcon({ e, saved, color, open, onToggle, onAdd, onRemove }: { e: TripEvent | EventCard; saved: boolean; color: string; open: boolean; onToggle: () => void; onAdd: () => void; onRemove: () => void }) {
  const time = "hoursUnknown" in e && e.hoursUnknown ? "" : `, ${formatEventTime(e.start, e.timeZone)}`;
  // The card opens where there's room: below the icon near the top of the screen, and
  // nudged sideways near its edges.
  const wrap = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ below: boolean; shift: number }>({ below: false, shift: 0 });
  useLayoutEffect(() => {
    if (!open || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    const half = Math.min(132, window.innerWidth / 2 - 12);
    const mid = r.left + r.width / 2;
    const shift = mid - half < 10 ? 10 - (mid - half) : mid + half > window.innerWidth - 10 ? window.innerWidth - 10 - (mid + half) : 0;
    setPlace({ below: r.top < 250, shift: Math.round(shift) });
  }, [open]);
  return (
    <div ref={wrap} className="event-icon-wrap" data-open={open || undefined}>
      <button
        key={saved ? "in" : "idea"}
        type="button"
        className="event-icon"
        data-saved={saved || undefined}
        style={{ "--ink": color } as React.CSSProperties}
        aria-label={`${saved ? "" : "Idea: "}${e.title}, ${dayLabel(dayOf(e))}${time}`}
        aria-expanded={open}
        onClick={(ev) => (ev.stopPropagation(), onToggle())}
      >
        <span aria-hidden>{GROUP_EMOJI[e.groupSlug] ?? "✨"}</span>
        {!saved && <span className="event-icon-plus" aria-hidden><Plus size={10} strokeWidth={3} /></span>}
        {saved && <span className="event-icon-check" aria-hidden><Check size={10} strokeWidth={3} /></span>}
      </button>
      {open && (
        <div className="event-pop" data-below={place.below || undefined} style={{ "--shift": `${place.shift}px` } as React.CSSProperties} role="dialog" aria-label={e.title} onClick={(ev) => ev.stopPropagation()}>
          <div className="flex gap-2.5">
            <Poster title={e.title} imageUrl={e.imageUrl} hue={e.posterHue} categorySlug={e.categorySlug} size="sm" className="h-14 w-14 shrink-0 rounded-[var(--radius-s)]" />
            <div className="min-w-0">
              <p className="font-semibold leading-snug line-clamp-2">{e.title}</p>
              <p className="t-micro text-text-2 mt-0.5">{dayLabel(dayOf(e))}{time}</p>
              <p className="t-micro text-text-3 truncate">{e.venueName}</p>
            </div>
          </div>
          <div className="mt-2.5 flex gap-1.5">
            {saved ? (
              <button type="button" className="btn btn-secondary btn-sm flex-1" onClick={onRemove}><X size={14} aria-hidden /> Remove</button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm flex-1 press" onClick={onAdd}><Plus size={14} aria-hidden /> Add to trip</button>
            )}
            <Link href={`/events/${e.slug}`} className="btn btn-secondary btn-sm btn-icon" aria-label={`Open ${e.title}`}><ExternalLink size={14} aria-hidden /></Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** One city of the trip: its days as an agenda (plans and events), and ideas for the free time. */
function StopPlan({ trip, stop, index, stops, dayEvents, ideas, onAdd, onOpen, onPickStop, onShowPlace }: { trip: Trip; stop: TripStop; index: number; stops: TripStop[]; dayEvents: { e: TripEvent; day: string }[]; ideas: EventCard[] | null; onAdd: (c: EventCard) => void; onOpen: (id: string) => void; onPickStop: (i: number) => void; onShowPlace: (p: TripPlan) => void }) {
  const days = useMemo(() => daysOf(stop.from, stop.to), [stop.from, stop.to]);
  const all = new URLSearchParams({ lat: stop.lat.toFixed(4), lng: stop.lng.toFixed(4), radius: String(RADIUS_KM), pl: placeName(stop), from: stop.from, to: stop.to });
  if (trip.interests?.length) all.set("cat", trip.interests.join(","));
  return (
    <div style={{ "--ink": stopColor(index) } as React.CSSProperties}>
      <p className="t-small text-text-2 mb-3">
        {dayLabel(stop.from)} → {dayLabel(stop.to)}, {nightsBetween(stop.from, stop.to)} {nightsBetween(stop.from, stop.to) === 1 ? "night" : "nights"}
      </p>
      <TripAgenda trip={trip} stops={stops} events={dayEvents} only={days} near={stop} onOpenEvent={onOpen} onPickStop={onPickStop} onShowPlace={onShowPlace} />
      <p className="trip-tip t-micro text-text-2">
        <span className="trip-tip-icon" aria-hidden><MapPin size={12} /></span>
        <span>Zoom into {placeName(stop)} on the globe to see its restaurants, museums, monuments and more; tap one to add it to the trip.</span>
      </p>
      <h2 className="t-small font-semibold mt-5">Ideas for your days in {placeName(stop)}</h2>
      {ideas === null ? (
        <div className="mt-2 grid gap-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14" />)}</div>
      ) : ideas.length ? (
        <ul className="mt-2 grid gap-1.5">
          {ideas.slice(0, 12).map((c) => (
            <li key={c.id} className="idea-row">
              <Poster title={c.title} imageUrl={c.imageUrl} hue={c.posterHue} categorySlug={c.categorySlug} size="sm" className="h-11 w-11 shrink-0 rounded-[var(--radius-s)]" />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(c.id)}>
                <span className="block font-semibold truncate">{c.title}</span>
                <span className="block t-micro text-text-3 truncate">{dayLabel(dayOf(c))}{c.hoursUnknown ? "" : `, ${formatEventTime(c.start, c.timeZone)}`}, {c.venueName}</span>
              </button>
              <button type="button" className="btn btn-secondary btn-icon btn-sm press" aria-label={`Add ${c.title} to the trip`} onClick={() => onAdd(c)}><Plus size={15} aria-hidden /></button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-small text-text-2 mt-2">Nothing listed there on those days yet{trip.interests?.length ? " for what you like" : ""}.</p>
      )}
      <Link href={`/events?${all}`} className="see-all t-small text-text-2 hover:text-text mt-3">Everything on in {placeName(stop)} those days →</Link>
    </div>
  );
}

/** The trip into a calendar (.ics) or as text to paste anywhere. */
function ExportButtons({ trip, events }: { trip: Trip; events: TripEvent[] }) {
  const [copied, setCopied] = useState(false);
  const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d+/, "");
  const ics = () => {
    const esc = (s: string) => s.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OMNIEVENT//Trip//EN", `X-WR-CALNAME:${esc(trip.name)}`];
    for (const s of trip.stops ?? []) lines.push("BEGIN:VEVENT", `UID:${trip.id}-${s.id}@omnievent`, `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART;VALUE=DATE:${s.from.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${s.to.replace(/-/g, "")}`, `SUMMARY:${esc(`${trip.name}: ${s.name}`)}`, "END:VEVENT");
    for (const pl of trip.plans ?? []) lines.push(...planIcs(pl, trip.id, stamp(new Date().toISOString())));
    for (const e of events) lines.push("BEGIN:VEVENT", `UID:${e.id}@omnievent`, `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART:${stamp(new Date(e.start).toISOString())}`, `SUMMARY:${esc(e.title)}`, `LOCATION:${esc(`${e.venueName}, ${e.city}`)}`, `URL:${window.location.origin}/events/${e.slug}`, "END:VEVENT");
    lines.push("END:VCALENDAR");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
    a.download = `${trip.name.replace(/[^\w-]+/g, "-").toLowerCase() || "trip"}.ics`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const copy = async () => {
    const text = [
      `${trip.emoji ?? "✈️"} ${trip.name}, ${longRange(trip.start, trip.end)}`,
      ...(trip.stops ?? []).flatMap((s) => [
        `${s.name}${s.place ? ` (${s.place})` : ""}: ${dayLabel(s.from)} to ${dayLabel(s.to)}`,
        ...events.map((e) => placeIn([s], e)).filter((p) => p.e.lat && p.fit.ok).map((p) => `  ${dayLabel(p.day)}: ${p.e.title} (${window.location.origin}/events/${p.e.slug})`),
      ]),
      ...((trip.plans ?? []).length ? ["", "Plans:"] : []),
      ...[...(trip.plans ?? [])].sort((a, b) => `${a.day}${a.time ?? ""}`.localeCompare(`${b.day}${b.time ?? ""}`)).map((p) => `  ${dayLabel(p.day)}${p.time ? ` ${p.time}` : ""}: ${kindLabel(p.kind)}, ${p.title}${p.from || p.to ? ` (${[p.from, p.to].filter(Boolean).join(" → ")})` : ""}${p.ref ? `, ${p.ref}` : ""}${p.place ? `, ${p.place}` : ""}`),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard not available
    }
  };
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={ics}><Download size={14} aria-hidden /> <span className="max-sm:sr-only">Calendar</span></button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}>{copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} <span className="max-sm:sr-only">{copied ? "Copied" : "Copy"}</span></button>
    </>
  );
}
