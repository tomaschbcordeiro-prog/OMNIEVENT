"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Copy, Download, ExternalLink, Globe2, LogOut, Pencil, Plane, Play, Plus, Sparkles, Trash2, TriangleAlert, Users, X } from "lucide-react";
import type { EventCard } from "@/lib/types";
import { userActions, useUser, type Trip } from "@/lib/user/store";
import { fitSpan, flagOf, midpoint, moved, nightsBetween, placeName, stopColor, withNights, type Fit, type TripStop } from "@/lib/trip";
import { listReorder, startLift } from "@/lib/lift";
import { isTravel, kindLabel, planIcs } from "@/lib/trip-plans";
import { KIND_ICON, TripAgenda } from "./agenda";
import { PoiCard, type MapPlace } from "./place-to-trip";
import { CityPlan, plansIn } from "./city-plan";
import { TripShow } from "./trip-show";
import { AddSheet } from "./add-sheet";
import { ShareTripDialog } from "./shared-trips";
import { TogetherBar, TogetherDialog, TripChat } from "./together";
import { TripMoney } from "./trip-money";
import { TripLists } from "./trip-lists";
import { TripInfo } from "./trip-info";
import { manageTrip, markSeen, stopSharing, useGroupSync } from "@/lib/group-sync";
import { listProgress, moneySummary } from "@/lib/trip-share";
import { ADD_EVENT, openAdd, type AddRequest } from "./add-bus";
import type { MapClick } from "../earth/earth-map";
import type { TripPlan } from "@/lib/trip-plans";
import { spanOf } from "@/lib/trip-snap";
import { rememberTrip } from "./trip-add";
import { stopSearch } from "./trip-shortcuts";
import { formatEventTime, localDateKey } from "@/lib/format";
import type { EarthMapHandle, FlyRequest } from "../earth/earth-map";
import { Poster } from "../ui";
import { toast } from "../toast";
import { bboxOf, CityPin, dayLabel, fanOut, longRange, MapIcons, routeOf, SheetGrab, shortRange, TripGlobe, tripSnapOf, usePanelPad, useSheet, useTripEvents, type MapIcon, type Pad, type TripEvent } from "./shared";

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
  /** The whole trip as an agenda, day by day, as its cities, its money, its lists, or the rest. */
  const [view, setView] = useState<"agenda" | "cities" | "money" | "lists" | "info">("agenda");
  /** Event icons are out (after the glide to the city, so they spring from the pin). */
  const [burst, setBurst] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  /** A place tapped on the globe (a museum, a restaurant…), to put on the trip. */
  const [poi, setPoi] = useState<(MapPlace & { below?: boolean }) | null>(null);
  const [fly, setFly] = useState<FlyRequest>();
  /** The trip playing as a show (from a city, or from the start). */
  const [showing, setShowing] = useState<{ at?: string; pad: Pad } | null>(null);
  // The trip's one Add sheet, asked for from anywhere on the page.
  const [adding, setAdding] = useState<{ req: AddRequest; n: number } | null>(null);
  /** The public Share dialog is open, or the planning-together one. */
  const [sharing, setSharing] = useState(false);
  const [together, setTogether] = useState(false);
  const [chat, setChat] = useState(false);
  // "Reply" on a message that just arrived opens the chat.
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<string>).detail === id && setChat(true);
    window.addEventListener("omni:trip-chat", on);
    return () => window.removeEventListener("omni:trip-chat", on);
  }, [id]);
  // What changed since this device last opened the trip: kept for this visit, then the visit counts.
  const [sinceAt, setSinceAt] = useState<string | undefined>();
  const groupId = trip?.group?.id;
  useEffect(() => {
    if (!groupId) return;
    setSinceAt(trip?.group?.lastOpened);
    markSeen(id, "trip");
    // Once per visit to this trip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, id]);
  // Planned with others: changes go out and come in while it's open.
  useGroupSync(trip?.id, !!trip?.group);
  const canEdit = !trip?.group || trip.group.role !== "viewer";
  /** "Later" pressed on the first steps: they don't come back for this trip. */
  const [startHidden, setStartHidden] = useState(true);
  useEffect(() => {
    try {
      setStartHidden(!!localStorage.getItem(`mundivi:trip-start:${id}`));
    } catch {
      setStartHidden(false);
    }
  }, [id]);
  const hideStart = () => {
    setStartHidden(true);
    try {
      localStorage.setItem(`mundivi:trip-start:${id}`, "1");
    } catch {
      // storage off: hidden for this visit
    }
  };
  useEffect(() => {
    const on = (e: Event) => setAdding((a) => ({ req: (e as CustomEvent<AddRequest>).detail ?? {}, n: (a?.n ?? 0) + 1 }));
    window.addEventListener(ADD_EVENT, on);
    return () => window.removeEventListener(ADD_EVENT, on);
  }, []);
  // "A" adds, from anywhere on the page.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "a" || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]") || document.querySelector(".addx, .show")) return;
      e.preventDefault();
      openAdd({});
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  // What went in: shown in its place in the agenda.
  const reveal = (id: string) => {
    if (document.querySelector(".show")) return;
    sheet.setSnap("half");
    window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`.trip-panel [data-plan="${id}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 160);
  };
  const play = (at?: string) => {
    setOpen(null);
    setPoi(null);
    const phone = window.matchMedia("(max-width: 1023px)").matches;
    setShowing({ at, pad: phone ? { top: 84, right: 0, bottom: Math.round(window.innerHeight * 0.46), left: 0 } : { top: 96, right: 48, bottom: 110, left: Math.min(500, Math.round(window.innerWidth * 0.36)) } });
  };
  const flyKey = useRef(0);
  const { events } = useTripEvents(trip);
  const sugg = useSuggestions(trip);
  const stops = useMemo(() => trip?.stops ?? [], [trip?.stops]);
  // Sent here to add something (from the trips page's "Add next"): the Add sheet opens on it.
  const asked = useRef(false);
  useEffect(() => {
    const a = sp.get("add");
    if (!trip || !a || asked.current) return;
    asked.current = true;
    const stop = stops.find((s) => s.id === sp.get("stop"));
    const leg = Number(sp.get("leg"));
    const [from, to] = [stops[leg - 1], stops[leg]];
    if ((a === "train" || a === "flight") && from && to) openAdd({ draft: { kind: a, title: `${kindLabel(a)} to ${to.name}`, day: from.to, from: from.name, to: to.name } });
    else if (a === "stay") openAdd({ stopId: stop?.id, day: stop?.from, kind: "stay" });
    else openAdd({ stopId: stop?.id, day: sp.get("day") || undefined });
    router.replace(`/trips/${trip.id}`, { scroll: false });
    // Once, when the trip is there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);
  const stop = sel === null ? undefined : stops[sel];
  useEffect(() => setLoaded(true), []);
  // Sent to one of the trip's parts (from its card): that tab, or the chat, straight away.
  const sentTo = useRef(false);
  useEffect(() => {
    if (!trip || sentTo.current) return;
    sentTo.current = true;
    const tab = sp.get("tab");
    if (tab === "money" || tab === "lists" || tab === "info" || tab === "cities") {
      setView(tab);
      if (tab !== "cities") sheet.setSnap("full");
    }
    if (sp.get("chat") && trip.group) setChat(true);
    // Planned to go with friends: the invitation, ready to send.
    if (sp.get("invite")) setTogether(true);
    if (tab || sp.get("chat")) router.replace(`/trips/${trip.id}`, { scroll: false });
    // Once, when the trip is there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);
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
    if (sp.get("show")) {
      play(sp.get("city") ?? undefined);
      router.replace(`/trips/${trip.id}`, { scroll: false });
    }
    if (sp.get("joined")) {
      const others = trip.group?.members.filter((m) => m.id !== trip.group?.me).map((m) => m.name) ?? [];
      toast({ title: "You're in!", body: others.length ? `You're planning this trip with ${others.join(", ")}. Everything you change, they see.` : "Everything you change is shared.", emoji: "🤝", celebrate: true });
      router.replace(`/trips/${trip.id}`, { scroll: false });
    }
    if (sp.get("hello")) {
      // With the invitation open over it, the note would only be hidden behind.
      // A trip with nothing in it yet shows its first steps in the panel instead.
      if (!sp.get("invite") && (trip.eventIds?.length ?? 0) > 0) toast({ title: "Your trip is ready", body: "Tap a city to see what's on while you're there.", emoji: trip.emoji ?? "✈️" });
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
  /** A city carried to another place in the route: each keeps its nights, the dates follow. */
  const reorderStops = (from: number, to: number) => {
    if (!trip || from === to) return;
    const before = trip.stops;
    const next = withNights(moved(stops, from, to), stops[0].from, moved(stops.map((s) => nightsBetween(s.from, s.to)), from, to));
    userActions.updateTrip(trip.id, { stops: next });
    toast({ title: `${stops[from].name} is now stop ${to + 1}`, body: next.map((s) => s.name).join(" → "), emoji: "🧭", action: { label: "Undo", run: () => userActions.updateTrip(trip.id, { stops: before }) } });
  };
  const cards = useRef<HTMLDivElement>(null);
  const carryStop = (e: React.PointerEvent<HTMLElement>, i: number) => {
    if (!canEdit || stops.length < 2 || !cards.current) return;
    startLift(e, listReorder({ box: cards.current, from: i, onDrop: (to) => reorderStops(i, to) }), { scroller: cards.current.closest<HTMLElement>("[data-lift-scroll]") });
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
        <p className="t-body text-text-2 mt-2">Trips are kept on the device they were planned on. Planning with someone? Ask them for the trip&apos;s link or PIN.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/trips/join" className="btn btn-secondary"><Users size={15} aria-hidden /> Join with a PIN</Link>
          <Link href="/trips" className="btn btn-secondary">Your trips</Link>
          <Link href="/trips/new" className="btn btn-primary">Plan a trip</Link>
        </div>
      </main>
    );
  }

  const nights = trip.start && trip.end ? nightsBetween(trip.start, trip.end) : 0;
  const flags = [...new Set(stops.map((s) => flagOf(s.countryCode)).filter(Boolean))];
  const off = placed.filter((p) => !p.fit.ok);
  // Just made, nothing in it yet: the first steps, all of them optional.
  const fresh = stops.length > 0 && canEdit && !startHidden && !events.length && !(trip.plans?.length) && !(trip.checklist?.length) && !(trip.expenses?.length);

  return (
    <div className="trip-stage" data-show={showing ? "" : undefined}>
      <TripGlobe api={api} route={routeOf(stops)} fly={fly} pad={showing?.pad ?? pad} quiet={!!showing} onReady={() => setReady(true)} onBackground={tapGlobe} label={`Globe with your trip ${trip.name}: tap a city to see its events; zoom in to see places (restaurants, museums…) and tap one to add it.`} />
      <MapIcons api={api} ready={ready} icons={icons} />
      {adding && (
        <AddSheet key={adding.n} trip={trip} stops={stops} events={dayEvents} req={adding.req} near={stop} onClose={() => setAdding(null)} onDone={reveal} />
      )}
      {sharing && <ShareTripDialog trip={trip} onClose={() => setSharing(false)} />}
      {chat && trip.group && <TripChat trip={trip} onClose={() => setChat(false)} />}
      {together && <TogetherDialog trip={trip} onClose={() => setTogether(false)} onPublish={() => (setTogether(false), setSharing(true))} />}
      {showing && ready && (
        <TripShow
          trip={trip}
          stops={stops}
          events={dayEvents}
          api={api}
          pad={showing.pad}
          startAt={showing.at}
          onClose={() => {
            setShowing(null);
            window.setTimeout(() => (sel === null ? frameAll() : pick(sel)), 60);
            window.setTimeout(() => document.querySelector<HTMLElement>(".view-trip")?.focus({ preventScroll: true }), 80);
          }}
        />
      )}

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
          {trip.group && <TogetherBar trip={trip} onOpen={() => setTogether(true)} onChat={() => setChat(true)} since={sinceAt} />}
          {trip.group?.role === "viewer" && <p className="t-micro text-text-2 mt-1">You can see everything on this trip. To change it, ask {trip.group.members.find((m) => m.role === "owner")?.name ?? "its owner"} to make you an editor.</p>}
          {fresh ? (
            <TripStart stops={stops} onThings={() => pick(0)} onInvite={() => setTogether(true)} onHide={hideStart} />
          ) : (
            <div className="trip-head-actions">
              {stops.length > 0 && canEdit && (
                <button type="button" className="trip-add press" onClick={() => openAdd({ stopId: stop?.id })}>
                  <span className="trip-add-plus" aria-hidden><Plus size={16} strokeWidth={2.75} /></span>
                  <span>{stop ? `Add to ${stop.name}` : "Add to trip"}</span>
                </button>
              )}
              {stops.length > 0 && (
                <button type="button" className="view-trip press" onClick={() => play(stop?.id)} disabled={!ready} aria-label={stop ? `View ${stop.name}, as a film on the globe` : "View the trip, as a film on the globe"}>
                  <span className="view-trip-play" aria-hidden><Play size={12} fill="currentColor" /></span>
                  <span>Play</span>
                </button>
              )}
              <button type="button" className="trip-share press" onClick={() => setTogether(true)} aria-label={trip.group ? "People on this trip and invitations" : "Plan this trip together: invite people"} data-shared={trip.group ? "" : undefined}>
                <Users size={16} aria-hidden />
                <span className="max-sm:sr-only">{trip.group ? "People" : "Invite"}</span>
              </button>
            </div>
          )}
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

        <div className="planner-body" key={sel ?? "all"} data-lift-scroll>
          {!stops.length && (view === "agenda" || view === "cities") && (
            <div className="trip-empty">
              <p className="font-semibold">This trip has no route yet</p>
              <p className="t-small text-text-2 mt-1">Add its cities and dates to see it on the globe, with what&apos;s on in each place.</p>
              <Link href={`/trips/new?edit=${trip.id}`} className="btn btn-primary btn-sm mt-3"><Pencil size={14} aria-hidden /> Add the route</Link>
            </div>
          )}

          {sel === null && (
            <div className="seg seg-trip no-scrollbar" role="tablist" aria-label="The trip's parts">
              <button type="button" role="tab" aria-selected={view === "agenda"} className="seg-btn" onClick={() => setView("agenda")}>Agenda</button>
              <button type="button" role="tab" aria-selected={view === "cities"} className="seg-btn" onClick={() => setView("cities")}>Cities</button>
              <button type="button" role="tab" aria-selected={view === "money"} className="seg-btn" onClick={() => (setView("money"), sheet.setSnap("full"))}>
                Money{(trip.expenses?.length ?? 0) > 0 && <span className="seg-note tnum">{(() => {
                  const m = moneySummary({ expenses: trip.expenses ?? [], currency: trip.currency });
                  try {
                    return new Intl.NumberFormat("en-GB", { style: "currency", currency: m.currency, maximumFractionDigits: 0 }).format(m.total);
                  } catch {
                    return Math.round(m.total).toLocaleString("en-GB");
                  }
                })()}</span>}
              </button>
              <button type="button" role="tab" aria-selected={view === "lists"} className="seg-btn" onClick={() => (setView("lists"), sheet.setSnap("full"))}>
                Lists{(trip.checklist?.length ?? 0) > 0 && <span className="seg-note tnum">{listProgress(trip.checklist ?? []).done}/{listProgress(trip.checklist ?? []).all}</span>}
              </button>
              <button type="button" role="tab" aria-selected={view === "info"} className="seg-btn" onClick={() => (setView("info"), sheet.setSnap("full"))}>Info</button>
            </div>
          )}
          {sel === null && view === "money" && <TripMoney trip={trip} canEdit={canEdit} />}
          {sel === null && view === "lists" && <TripLists trip={trip} canEdit={canEdit} />}
          {sel === null && view === "info" && <TripInfo trip={trip} canEdit={canEdit} />}
          {sel === null && view === "agenda" && <TripAgenda trip={trip} stops={stops} events={dayEvents} onOpenEvent={showEvent} onPickStop={(i) => pick(i)} onShowPlace={showPlace} />}

          {sel === null && view === "cities" && (
            <>
            {canEdit && stops.length > 1 && <p className="lift-hint">Hold a city and drag it to change the order.</p>}
            <div ref={cards} className="stop-cards" data-glide>
            {stops.map((s, i) => {
              const mine = placed.filter((p) => p.fit.ok && p.fit.stop.id === s.id);
              const n = sugg[s.id];
              return (
                <button key={s.id} type="button" className="stop-card press" style={{ "--ink": stopColor(i) } as React.CSSProperties} onClick={() => pick(i)} onPointerDown={(e) => carryStop(e, i)}>
                  <span className="planner-stop-n" aria-hidden>{i + 1}</span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block font-semibold">{s.name} <span aria-hidden>{flagOf(s.countryCode)}</span>{s.place && <span className="t-micro font-normal text-text-3"> · {s.place}</span>}</span>
                    <span className="block t-small text-text-2">{dayLabel(s.from)} → {dayLabel(s.to)}, {nightsBetween(s.from, s.to)} {nightsBetween(s.from, s.to) === 1 ? "night" : "nights"}</span>
                  </span>
                  <span className="stop-card-counts t-micro tnum">
                    <span><b>{mine.length + plansIn(trip, s).length}</b> planned</span>
                    <span className="text-text-3">{n == null ? "…" : n.filter((c) => !inTrip.has(c.id)).length} ideas</span>
                  </span>
                </button>
              );
            })}
            </div>
            </>
          )}

          {sel === null && view === "cities" && stops.length > 0 && (
            <p className="trip-tip t-micro text-text-2">
              <span className="trip-tip-icon" aria-hidden><Plane size={12} /></span>
              <span>
                Add events from anywhere on Mundivi: the plane button on any event puts it here, and on a computer you can drag events onto your trip.{" "}
                <Link href={stopSearch(stops[0])} className="font-semibold text-cyan hover:underline">Browse {placeName(stops[0])} →</Link>
              </span>
            </p>
          )}

          {stop && sel !== null && (
            <CityPlan
              trip={trip}
              stop={stop}
              index={sel}
              stops={stops}
              dayEvents={dayEvents}
              ideas={(sugg[stop.id] ?? null)?.filter((c) => !inTrip.has(c.id)) ?? null}
              eventsLink={stopEventsLink(stop, trip)}
              onAdd={add}
              onOpen={showEvent}
              onPickStop={(i) => pick(i)}
              onShowPlace={showPlace}
              onShowAt={(lat, lng) => (setFly({ key: ++flyKey.current, lat, lng, zoom: 16.5, padding: pad }), sheet.setSnap("half"))}
            />
          )}

          {off.length > 0 && sel === null && (
            <section className="mt-5" aria-labelledby="off-h">
              <h2 id="off-h" className="t-small font-semibold flex items-center gap-1.5 text-warn"><TriangleAlert size={15} aria-hidden /> Not on your route</h2>
              <ul className="mt-2 grid gap-1.5" data-glide>
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
          {canEdit && <Link href={`/trips/new?edit=${trip.id}`} className="btn btn-secondary btn-sm"><Pencil size={14} aria-hidden /> <span><span className="max-sm:hidden">Edit </span>Route</span></Link>}
          <ExportButtons trip={trip} events={events} />
          {trip.group ? (
            <button type="button" className="btn btn-ghost btn-icon btn-sm text-bad" aria-label="Leave this shared trip and remove it from this device" onClick={() => {
              const g = trip.group!;
              const alone = g.members.length <= 1;
              if (g.role === "owner" && !alone) return setTogether(true);
              if (!confirm(alone ? `Delete “${trip.name}”? Nobody else is in it.` : `Leave “${trip.name}” and remove it from this device? The others keep planning it.`)) return;
              void (alone && g.role === "owner" ? stopSharing(trip.id) : manageTrip(trip.id, { do: "leave" }))
                .catch(() => {})
                .finally(() => {
                  userActions.deleteTrip(trip.id);
                  router.push("/trips");
                });
            }}><LogOut size={15} aria-hidden /></button>
          ) : (
            <button type="button" className="btn btn-ghost btn-icon btn-sm text-bad" aria-label="Delete this trip" onClick={() => {
              if (!confirm(`Delete “${trip.name}”?`)) return;
              userActions.deleteTrip(trip.id);
              router.push("/trips");
            }}><Trash2 size={15} aria-hidden /></button>
          )}
        </footer>
      </section>
    </div>
  );
}

/**
 * A trip just made, with only its route: what can come next, every bit of it optional (things
 * to do, where to sleep, getting there, places to see, friends). Gone once anything is added,
 * or when "Later" is pressed.
 */
function TripStart({ stops, onThings, onInvite, onHide }: { stops: TripStop[]; onThings: () => void; onInvite: () => void; onHide: () => void }) {
  const first = stops[0];
  const tiles: { key: string; label: string; Icon: typeof Plane; tint: string; run: () => void }[] = [
    { key: "do", label: "Things to do", Icon: Sparkles, tint: "#0a94c9", run: onThings },
    { key: "stay", label: "Where to sleep", Icon: KIND_ICON.stay, tint: "#7b4dff", run: () => openAdd({ kind: "stay", stopId: first.id }) },
    { key: "go", label: "Getting there", Icon: KIND_ICON.flight, tint: "#1463ff", run: () => openAdd({ kind: "flight", stopId: first.id }) },
    { key: "see", label: "Places to see", Icon: KIND_ICON.visit, tint: "#d97706", run: () => openAdd({ kind: "place", stopId: first.id }) },
    { key: "friends", label: "Invite friends", Icon: Users, tint: "#d63384", run: onInvite },
  ];
  return (
    <section className="trip-start" aria-labelledby="trip-start-h">
      <div className="trip-start-head">
        <h2 id="trip-start-h" className="trip-start-title">
          <span className="trip-start-check" aria-hidden><Check size={12} strokeWidth={3.2} /></span>
          Your route is set
        </h2>
        <button type="button" className="trip-start-later" onClick={onHide}>Later</button>
      </div>
      <p className="trip-start-sub">Add the rest whenever you like. None of it is needed now.</p>
      <ul className="trip-start-tiles no-scrollbar">
        {tiles.map(({ key, label, Icon, tint, run }, i) => (
          <li key={key} style={{ "--k": tint, "--i": i } as React.CSSProperties}>
            <button type="button" className="trip-start-tile press" onClick={run}>
              <span className="trip-start-icon" aria-hidden><Icon size={17} /></span>
              <span className="trip-start-label">{label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
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

/** Everything on in a city on the days spent there, on the events page. */
function stopEventsLink(stop: TripStop, trip: Trip): string {
  const all = new URLSearchParams({ lat: stop.lat.toFixed(4), lng: stop.lng.toFixed(4), radius: String(RADIUS_KM), pl: placeName(stop), from: stop.from, to: stop.to });
  if (trip.interests?.length) all.set("cat", trip.interests.join(","));
  return `/events?${all}`;
}

/** The trip into a calendar (.ics) or as text to paste anywhere. */
function ExportButtons({ trip, events }: { trip: Trip; events: TripEvent[] }) {
  const [copied, setCopied] = useState(false);
  const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d+/, "");
  const ics = () => {
    const esc = (s: string) => s.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mundivi//Trip//EN", `X-WR-CALNAME:${esc(trip.name)}`];
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
      <button type="button" className="btn btn-secondary btn-sm" onClick={ics}><Download size={14} aria-hidden /> <span>Calendar</span></button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}>{copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} <span>{copied ? "Copied" : "Copy"}</span></button>
    </>
  );
}
