"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, Plane, Plus, X } from "lucide-react";
import type { EventCard } from "@/lib/types";
import { userActions, useUser, type Trip } from "@/lib/user/store";
import { extendFor, fitSpan, STOP_RADIUS_KM, type Fit } from "@/lib/trip";
import { haversineKm } from "@/lib/geo";
import { localDateKey } from "@/lib/format";
import { spanOf, tripSnapOf, type TripEvent } from "@/lib/trip-snap";
import { toast } from "../toast";

/*
 * Adding events to trips from anywhere: one button for every event on the site, the menu it
 * opens, the trip dock events fly into (and can be dragged onto), and the "t" key.
 */

const ACTIVE = "omnievent:trip:active";
const DRAG_TYPE = "application/x-omnievent-event";
const today = () => new Date().toISOString().slice(0, 10);
const dayOf = (e: { start: string; timeZone: string }) => localDateKey(e.start, e.timeZone);
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** The trip being worked on: the one last opened or added to, else the next one coming up. */
export function activeTripOf(trips: Trip[]): Trip | undefined {
  let id: string | null = null;
  try {
    id = localStorage.getItem(ACTIVE);
  } catch {
    // storage off
  }
  const now = today();
  const live = (t: Trip) => !t.end || t.end >= now;
  const chosen = trips.find((t) => t.id === id && live(t));
  if (chosen) return chosen;
  const next = trips.filter((t) => t.end && t.end >= now).sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""))[0];
  return next ?? [...trips].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function rememberTrip(id: string) {
  try {
    localStorage.setItem(ACTIVE, id);
  } catch {
    // storage off
  }
  window.dispatchEvent(new Event("omni:trip-active"));
}

type Timing = Pick<TripEvent, "start" | "timeZone" | "until" | "eventType">;
const runsFor = (e: Timing) => e.eventType === "daily_attraction" || !!e.until;

/** When an event is on, in a few words: "Tue 24 Nov", "Until Sun 6 Dec", "Open daily". */
function whenOf(e: Timing): string {
  if (e.eventType === "daily_attraction") return "Open daily";
  if (e.until) return `Until ${dayName(localDateKey(e.until, e.timeZone))}`;
  return dayName(dayOf(e));
}

/** Where an event stands with each trip: in it already, and whether it fits its route and dates. */
export function standing(trips: Trip[], e: Pick<TripEvent, "id" | "lat" | "lng" | "start" | "timeZone" | "until" | "eventType">) {
  const span = spanOf(e);
  return trips.map((t) => ({ trip: t, has: t.eventIds.includes(e.id), fit: t.stops?.length ? fitSpan(t.stops, span) : null }));
}

/** A fit in a few words: "Brussels, Wed 5 Jun", "After this trip"… */
function fitNote(fit: Fit | null, e: Timing): string {
  if (!fit) return "No route yet";
  if (fit.ok) return runsFor(e) ? `${fit.stop.name}, while you're there` : `${fit.stop.name}, ${dayName(dayOf(e))}`;
  return fit.why === "before" ? "Before this trip" : fit.why === "after" ? "After this trip" : fit.why === "wrong-days" ? `You're not in ${fit.stop?.name} that day` : "Not on this route";
}

/** Where to stretch a trip to for an event just outside it: the trip's own city when it's one. */
function stretchFor(trip: Trip, e: TripEvent) {
  if (!trip.stops?.length || runsFor(e)) return null;
  const near = trip.stops.find((s) => haversineKm(s.lat, s.lng, e.lat, e.lng) <= STOP_RADIUS_KM);
  const place = near ? { name: near.name, country: near.country, countryCode: near.countryCode, lat: near.lat, lng: near.lng, cityId: near.cityId } : { name: e.city, countryCode: e.countryCode, lat: e.lat, lng: e.lng, cityId: e.cityId };
  return extendFor(trip.stops, { lat: e.lat, lng: e.lng, day: dayOf(e), place });
}

/** The picture of an event flies from where it was tapped into the trip dock. */
function flyFrom(el: Element | null, e: TripEvent, trip: Trip) {
  const r = el?.getBoundingClientRect();
  window.dispatchEvent(new CustomEvent("omni:trip-fly", { detail: { x: r ? r.left + r.width / 2 : window.innerWidth / 2, y: r ? r.top + r.height / 2 : window.innerHeight / 2, image: e.imageUrl, emoji: trip.emoji, tripId: trip.id } }));
}

/** Adds an event to a trip: it flies there, the phone buzzes, and a note says where it fits (with Undo). */
export function addToTrip(trip: Trip, e: TripEvent, from: Element | null) {
  userActions.setTripEvent(trip.id, e, true);
  rememberTrip(trip.id);
  flyFrom(from, e, trip);
  try {
    navigator.vibrate?.(12);
  } catch {
    // no vibration here
  }
  const fit = standing([trip], e)[0].fit;
  toast({
    title: `Added to ${trip.name}`,
    body: fit?.ok ? `${e.title}: ${fitNote(fit, e)}` : e.title,
    emoji: trip.emoji ?? "✈️",
    action: { label: "Undo", run: () => userActions.setTripEvent(trip.id, e, false) },
    href: `/trips/${trip.id}`,
    linkLabel: "See trip",
  });
}

/** The address of a new trip planned round an event. */
export function planAround(e: TripEvent): string {
  const p = new URLSearchParams({ date: dayOf(e), event: e.id });
  if (e.cityId) p.set("city", e.cityId);
  else p.set("place", `${e.lat.toFixed(4)},${e.lng.toFixed(4)},${encodeURIComponent(e.city)},${e.countryCode ?? ""}`);
  return `/trips/new?${p}`;
}

async function fetchEvent(id: string): Promise<TripEvent | null> {
  try {
    const r = await fetch(`/api/events/batch?ids=${encodeURIComponent(id)}`);
    const j = (await r.json()) as { items: EventCard[] };
    return j.items[0] ? tripSnapOf(j.items[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Add to trip, for any event anywhere. When the event fits exactly one trip (near a city on
 * its route, on a day spent there), a tap adds it there at once; otherwise a menu lists the
 * trips, those it fits first, and offers to stretch a trip or plan a new one round it.
 */
export function TripButton({ card, event, id, title, variant = "icon", primary = false, className = "" }: { card?: EventCard; event?: TripEvent; id?: string; title: string; variant?: "icon" | "label" | "bare"; primary?: boolean; className?: string }) {
  const user = useUser();
  const btn = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<TripEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const eid = event?.id ?? card?.id ?? id ?? "";
  const inTrips = user.trips.filter((t) => t.eventIds.includes(eid));
  const known = useMemo(() => event ?? (card ? tripSnapOf(card) : null), [event, card]);
  const only = useMemo(() => {
    if (!known) return null;
    const fits = standing(user.trips, known).filter((s) => s.fit?.ok && !s.has);
    return fits.length === 1 && !inTrips.length ? fits[0].trip : null;
  }, [known, user.trips, inTrips.length]);

  const tap = async () => {
    let e = known;
    if (!e) {
      setBusy(true);
      e = await fetchEvent(eid);
      setBusy(false);
      if (!e) return toast({ title: "Couldn't load this event", body: "Try again in a moment.", emoji: "⚠️" });
    }
    if (only) return addToTrip(only, e, btn.current);
    setMenu(e);
  };

  const label = inTrips.length === 1 ? `In ${inTrips[0].name}` : inTrips.length > 1 ? `In ${inTrips.length} trips` : only ? `Add to ${only.name}` : "Add to trip";
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`trip-btn press ${variant === "label" ? "btn btn-secondary btn-sm" : variant === "bare" ? "" : `btn btn-sm btn-icon ${inTrips.length ? "text-cyan" : "btn-ghost"}`} ${className}`}
        data-in={inTrips.length ? "" : undefined}
        data-trip-button=""
        data-primary={primary ? "" : undefined}
        aria-haspopup={only ? undefined : "dialog"}
        aria-label={`${label}: ${title}`}
        title={`${label} (t)`}
        disabled={busy}
        onClick={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          void tap();
        }}
      >
        <span className="trip-btn-icon" aria-hidden>
          <Plane size={variant === "label" ? 14 : 15} />
          <span className="trip-btn-badge">{inTrips.length ? <Check size={8} strokeWidth={4} /> : <Plus size={8} strokeWidth={4} />}</span>
        </span>
        {variant === "label" && <span className="truncate max-w-[12rem]">{label}</span>}
      </button>
      {menu && <TripMenu e={menu} anchor={btn.current} onClose={() => (setMenu(null), btn.current?.focus())} />}
    </>
  );
}

/** The trips an event can go in: a popover by the button (a sheet on phones). */
function TripMenu({ e, anchor, onClose }: { e: TripEvent; anchor: HTMLElement | null; onClose: () => void }) {
  const user = useUser();
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; sheet: boolean } | null>(null);
  const rows = useMemo(() => {
    const list = standing(user.trips, e);
    const rank = (s: (typeof list)[number]) => (s.has ? 0 : s.fit?.ok ? 1 : 2);
    return list.sort((a, b) => rank(a) - rank(b) || (a.trip.start ?? "9").localeCompare(b.trip.start ?? "9"));
  }, [user.trips, e]);

  useLayoutEffect(() => {
    const sheet = window.innerWidth < 640;
    const r = anchor?.getBoundingClientRect();
    if (sheet || !r) return setPos({ left: 0, top: 0, sheet: true });
    const w = 320;
    const h = Math.min(420, 120 + rows.length * 64);
    const below = r.bottom + h + 12 < window.innerHeight;
    setPos({ left: Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w)), top: below ? r.bottom + 8 : Math.max(12, r.top - h - 8), sheet: false });
  }, [anchor, rows.length]);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>("button, a")?.focus();
    const onKey = (k: KeyboardEvent) => k.key === "Escape" && onClose();
    const onDown = (p: PointerEvent) => {
      if (box.current && !box.current.contains(p.target as Node) && !anchor?.contains(p.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [anchor, onClose]);

  if (!pos) return null;
  return createPortal(
    <>
      {pos.sheet && <div className="trip-menu-backdrop" aria-hidden onClick={onClose} />}
      <div ref={box} className={`trip-menu ${pos.sheet ? "is-sheet" : ""}`} style={pos.sheet ? undefined : { left: pos.left, top: pos.top }} role="dialog" aria-label={`Add ${e.title} to a trip`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">Add to a trip</p>
            <p className="t-micro text-text-3 truncate">{e.title}, {whenOf(e)}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm -mr-1.5 -mt-1" aria-label="Close" onClick={onClose}><X size={16} aria-hidden /></button>
        </div>
        {rows.length > 0 && (
          <ul className="mt-2 grid gap-1">
            {rows.map(({ trip, has, fit }) => {
              const stretch = !has && fit && !fit.ok && (fit.why === "before" || fit.why === "after") ? stretchFor(trip, e) : null;
              return (
                <li key={trip.id} className="trip-menu-row" data-fits={fit?.ok ? "" : undefined}>
                  <button
                    type="button"
                    className="trip-menu-item"
                    aria-pressed={has}
                    onClick={(ev) => {
                      if (has) {
                        userActions.setTripEvent(trip.id, e, false);
                        toast({ title: `Taken out of ${trip.name}`, body: e.title, emoji: "🗑️", action: { label: "Undo", run: () => userActions.setTripEvent(trip.id, e, true) } });
                      } else {
                        addToTrip(trip, e, ev.currentTarget);
                        onClose();
                      }
                    }}
                  >
                    <span className="text-lg" aria-hidden>{trip.emoji ?? "✈️"}</span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block font-semibold truncate">{trip.name}</span>
                      <span className={`block t-micro ${fit?.ok ? "text-ok" : "text-text-3"}`}>{fit?.ok ? "Fits: " : ""}{fitNote(fit, e)}</span>
                    </span>
                    <span className="trip-menu-toggle" aria-hidden>{has ? <Check size={15} /> : <Plus size={15} />}</span>
                  </button>
                  {stretch && (
                    <button
                      type="button"
                      className="trip-menu-stretch"
                      title="Changes the trip's dates and adds this event to it"
                      onClick={(ev) => {
                        const s = stretch.stops;
                        userActions.updateTrip(trip.id, { stops: s, start: s[0].from, end: s[s.length - 1].to });
                        addToTrip({ ...trip, stops: s }, e, ev.currentTarget);
                        onClose();
                      }}
                    >
                      <Plus size={13} aria-hidden /> {stretch.label}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Link href={planAround(e)} className="btn btn-primary btn-sm w-full mt-3" onClick={onClose}>
          <Plane size={14} aria-hidden /> {rows.length ? "Plan a new trip around it" : "Plan a trip around it"}
        </Link>
      </div>
    </>,
    document.body,
  );
}

/** Where an event stands with your trips, as a small tag on its card ("In Benelux", "Fits Benelux"). */
export function TripTag({ c, className = "" }: { c: EventCard; className?: string }) {
  const user = useUser();
  if (!user.trips.length || c.online) return null;
  const s = standing(user.trips, c);
  const has = s.find((x) => x.has);
  const fits = s.find((x) => x.fit?.ok && !x.has);
  const t = has ?? fits;
  if (!t) return null;
  return (
    <span className={`trip-tag ${className}`} data-in={has ? "" : undefined} title={has ? `In your trip ${t.trip.name}` : `Fits your trip ${t.trip.name}`}>
      <Plane size={11} aria-hidden /> {has ? "In" : "Fits"} {t.trip.name}
    </span>
  );
}

/** Lets an event card be dragged onto the trip dock (desktop). */
export function dragEvent(ev: React.DragEvent, c: EventCard) {
  try {
    ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify(tripSnapOf(c)));
    ev.dataTransfer.effectAllowed = "copyLink";
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent("omni:trip-drag", { detail: true }));
}

/**
 * The trip dock: a small pass for the trip you're working on, in the corner. Events fly into
 * it when added, and can be dragged onto it (or onto any trip, which it lists while dragging).
 * On phones it shows up only as events land.
 */
export function TripDock() {
  const user = useUser();
  const path = usePathname();
  const router = useRouter();
  const dock = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [tick, setTick] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [landing, setLanding] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    window.addEventListener("omni:trip-active", on);
    return () => window.removeEventListener("omni:trip-active", on);
  }, []);
  // tick re-reads the remembered trip.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const active = useMemo(() => (mounted ? activeTripOf(user.trips) : undefined), [mounted, user.trips, tick]);
  const upcoming = useMemo(() => user.trips.filter((t) => !t.end || t.end >= today()).slice(0, 4), [user.trips]);
  const onTripPage = path.startsWith("/trips");

  // An event flies in: its picture travels from the tap to the dock, which then gives a bump.
  useEffect(() => {
    const onFly = (ev: Event) => {
      const d = (ev as CustomEvent<{ x: number; y: number; image?: string; emoji?: string }>).detail;
      setLanding(true);
      window.setTimeout(() => setLanding(false), 2600);
      requestAnimationFrame(() => {
        const target = dock.current?.getBoundingClientRect();
        if (!target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const chip = document.createElement("div");
        chip.className = "trip-fly";
        // The event's picture, or the trip's emoji when it has none.
        if (d.image) chip.style.backgroundImage = `url("${d.image.replace(/["\\\n]/g, "")}")`;
        else chip.textContent = d.emoji ?? "✈️";
        chip.style.left = `${d.x - 22}px`;
        chip.style.top = `${d.y - 22}px`;
        document.body.appendChild(chip);
        const dx = target.left + 22 - d.x;
        const dy = target.top + target.height / 2 - d.y;
        const anim = chip.animate(
          [
            { transform: "translate(0, 0) scale(1)", opacity: 1 },
            { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 80}px) scale(0.9)`, opacity: 1, offset: 0.45 },
            { transform: `translate(${dx}px, ${dy}px) scale(0.35)`, opacity: 0.4 },
          ],
          { duration: 720, easing: "cubic-bezier(0.45, 0, 0.2, 1)" },
        );
        anim.onfinish = () => {
          chip.remove();
          dock.current?.classList.remove("is-bump");
          void dock.current?.offsetWidth;
          dock.current?.classList.add("is-bump");
        };
      });
    };
    const onDrag = (ev: Event) => setDragging(!!(ev as CustomEvent<boolean>).detail);
    const onEnd = () => {
      setDragging(false);
      setOver(null);
    };
    window.addEventListener("omni:trip-fly", onFly);
    window.addEventListener("omni:trip-drag", onDrag);
    document.addEventListener("dragend", onEnd);
    document.addEventListener("drop", onEnd);
    return () => {
      window.removeEventListener("omni:trip-fly", onFly);
      window.removeEventListener("omni:trip-drag", onDrag);
      document.removeEventListener("dragend", onEnd);
      document.removeEventListener("drop", onEnd);
    };
  }, []);

  const dropOn = useCallback(
    (ev: React.DragEvent, trip: Trip | null) => {
      const raw = ev.dataTransfer.getData(DRAG_TYPE);
      if (!raw) return;
      ev.preventDefault();
      setDragging(false);
      setOver(null);
      let e: TripEvent;
      try {
        e = JSON.parse(raw) as TripEvent;
      } catch {
        return;
      }
      if (!trip) return router.push(planAround(e));
      if (trip.eventIds.includes(e.id)) return toast({ title: `Already in ${trip.name}`, body: e.title, emoji: trip.emoji ?? "✈️" });
      addToTrip(trip, e, dock.current);
    },
    [router],
  );
  const dropProps = (id: string, trip: Trip | null) => ({
    onDragOver: (ev: React.DragEvent) => {
      if (!ev.dataTransfer.types.includes(DRAG_TYPE)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      setOver(id);
    },
    onDragLeave: () => setOver((o) => (o === id ? null : o)),
    onDrop: (ev: React.DragEvent) => dropOn(ev, trip),
  });

  if (!mounted || onTripPage) return null;
  if (!active && !dragging) return null;
  const visible = dragging || landing || path !== "/";
  return (
    <div ref={dock} className="trip-dock" data-show={visible ? "" : undefined} data-landing={landing ? "" : undefined} data-dragging={dragging ? "" : undefined} aria-live="polite">
      {dragging ? (
        <div className="trip-dock-drop">
          <p className="t-micro font-semibold text-text-2 px-1">Drop on a trip</p>
          {(upcoming.length ? upcoming : []).map((t) => (
            <div key={t.id} className="trip-dock-zone" data-over={over === t.id ? "" : undefined} {...dropProps(t.id, t)}>
              <span aria-hidden>{t.emoji ?? "✈️"}</span> <span className="truncate">{t.name}</span>
            </div>
          ))}
          <div className="trip-dock-zone is-new" data-over={over === "new" ? "" : undefined} {...dropProps("new", null)}>
            <Plus size={14} aria-hidden /> New trip around it
          </div>
        </div>
      ) : active ? (
        <Link href={`/trips/${active.id}`} className="trip-dock-pass" onClick={() => rememberTrip(active.id)}>
          <span className="trip-dock-emoji" aria-hidden>{active.emoji ?? "✈️"}</span>
          <span className="min-w-0">
            <span className="block t-micro text-text-3 leading-none">Your trip</span>
            <span className="block font-semibold truncate leading-tight">{active.name}</span>
          </span>
          <span className="trip-dock-count tnum" key={active.eventIds.length}>{active.eventIds.length}</span>
        </Link>
      ) : null}
    </div>
  );
}
