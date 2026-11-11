"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Navigation, Plane, Plus, X } from "lucide-react";
import { userActions, useUser, type Trip } from "@/lib/user/store";
import { addDays, daysOf, STOP_RADIUS_KM } from "@/lib/trip";
import { haversineKm } from "@/lib/geo";
import { kindLabel, type TripPlan } from "@/lib/trip-plans";
import { planKindForPoi, POI_COLOR, poiGroup, poiLabel } from "@/lib/pois";
import { activeTripOf, rememberTrip } from "./trip-add";
import { toast } from "../toast";

/*
 * A place from the map (a museum, a restaurant, a palace…) into a trip: on a day of the
 * city it's in, or on no day yet ("places to see"), with a time and a note if wanted. All of
 * it can be changed later in the trip's agenda.
 */

export interface MapPlace {
  name: string;
  lat: number;
  lng: number;
  /** The map's own kind for it (restaurant, museum…). */
  poi?: { cls: string; sub?: string };
}

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 12) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`);
const today = () => new Date().toISOString().slice(0, 10);

/** The same place on a trip already (it was added before). */
export function planAt(trip: Trip | undefined, place: MapPlace): TripPlan | undefined {
  return trip?.plans?.find((p) => p.lat != null && p.lng != null && Math.abs(p.lat - place.lat) < 0.0006 && Math.abs(p.lng - place.lng) < 0.0006);
}

export function PlaceToTrip({ place, tripId, onDone }: { place: MapPlace; /** Always this trip (a trip's own globe). */ tripId?: string; onDone?: () => void }) {
  const user = useUser();
  const trips = useMemo(() => user.trips.filter((t) => t.id === tripId || !t.end || t.end >= today()), [user.trips, tripId]);
  const [chosen, setChosen] = useState<string | undefined>(tripId);
  useEffect(() => {
    if (!tripId && !chosen) setChosen(activeTripOf(trips)?.id ?? trips[0]?.id);
  }, [tripId, chosen, trips]);
  const trip = trips.find((t) => t.id === (tripId ?? chosen));
  const group = poiGroup(place.poi?.cls, place.poi?.sub);
  const kind = planKindForPoi(group);
  const already = planAt(trip, place);
  // The days of the trip's city it's in (else all of the trip's).
  const city = trip?.stops?.find((s) => haversineKm(s.lat, s.lng, place.lat, place.lng) <= STOP_RADIUS_KM);
  const days = city ? daysOf(city.from, city.to) : trip?.stops?.length ? daysOf(trip.stops[0].from, trip.stops[trip.stops.length - 1].to) : [];
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");

  const at = `${place.lat.toFixed(4)},${place.lng.toFixed(4)},${encodeURIComponent(place.name)}`;
  if (!trips.length || !trip)
    return (
      <Link href={`/trips/new?place=${at}`} className="btn btn-primary btn-sm w-full">
        <Plane size={14} aria-hidden /> Plan a trip here
      </Link>
    );
  if (already)
    return (
      <div className="ptt-done">
        <Check size={15} aria-hidden className="shrink-0" />
        <span className="min-w-0 flex-1">
          In <Link href={`/trips/${trip.id}`} className="font-semibold hover:underline">{trip.name}</Link>
          <span className="text-text-3">, {already.day ? `${fmt(already.day)}${already.time ? ` ${already.time}` : ""}` : "no day yet"}</span>
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            userActions.removePlan(trip.id, already.id);
            toast({ title: `Taken off ${trip.name}`, body: already.title, emoji: "🗑️", action: { label: "Undo", run: () => userActions.addPlan(trip.id, already) } });
          }}
        >
          Remove
        </button>
      </div>
    );

  const add = () => {
    const plan: TripPlan = {
      id: newId(),
      kind,
      title: place.name.slice(0, 80),
      day,
      ...(day && time ? { time } : {}),
      ...(kind === "stay" && day ? { endDay: addDays(day, 1) } : {}),
      ...(note.trim() ? { notes: note.trim().slice(0, 200) } : {}),
      lat: place.lat,
      lng: place.lng,
      ...(place.poi ? { poi: place.poi.sub && place.poi.sub !== place.poi.cls ? `${place.poi.cls}/${place.poi.sub}` : place.poi.cls } : {}),
      createdAt: new Date().toISOString(),
    };
    userActions.addPlan(trip.id, plan);
    rememberTrip(trip.id);
    try {
      navigator.vibrate?.(10);
    } catch {
      // no vibration here
    }
    toast({ title: `Added to ${trip.name}`, body: `${place.name}${day ? `, ${fmt(day)}${time ? ` ${time}` : ""}` : ", a place to see"}`, emoji: "📍", action: { label: "Undo", run: () => userActions.removePlan(trip.id, plan.id) }, href: `/trips/${trip.id}`, linkLabel: "See trip" });
    setOpen(false);
    setNote("");
    setDay("");
    setTime("");
    onDone?.();
  };

  if (!open)
    return (
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary btn-sm flex-1 min-w-0 press" onClick={add}>
          <Plus size={14} aria-hidden className="shrink-0" /> <span className="truncate">{tripId ? "Add to trip" : `Add to ${trip.name}`}</span>
        </button>
        <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => setOpen(true)} aria-label="Add with a day or a note">
          Day, note…
        </button>
      </div>
    );

  return (
    <form
      className="ptt-form"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      {!tripId && trips.length > 1 && (
        <label className="ag-field">
          <span>Trip</span>
          <select value={trip.id} onChange={(e) => (setChosen(e.target.value), setDay(""))}>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>{t.emoji ?? "✈️"} {t.name}</option>
            ))}
          </select>
        </label>
      )}
      <div>
        <p className="ptt-label">When{city ? ` in ${city.name}` : ""}</p>
        <div className="ptt-days" role="radiogroup" aria-label="Day">
          <button type="button" role="radio" aria-checked={day === ""} className="ptt-day" onClick={() => setDay("")}>No day yet</button>
          {days.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={day === d} className="ptt-day" onClick={() => setDay(d)}>{fmt(d)}</button>
          ))}
        </div>
      </div>
      {day && (
        <label className="ag-field">
          <span>Time (optional)</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      )}
      <label className="ag-field">
        <span>Note (optional)</span>
        <textarea value={note} maxLength={200} rows={2} onChange={(e) => setNote(e.target.value)} placeholder={kind === "meal" ? "Book a table; try the fish" : "Free on the first Sunday; go early"} />
      </label>
      <div className="ag-form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm press">
          <Plus size={14} aria-hidden /> Add {kindLabel(kind).toLowerCase() === "note" ? "" : kindLabel(kind).toLowerCase()} to trip
        </button>
      </div>
    </form>
  );
}

/** Stops a map's own gestures (pan, zoom, keys, taps) inside a card laid on it. */
const keep = {
  onMouseDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onTouchStart: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onWheel: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
};

/** A place tapped on a trip's globe: what it is, the way there, and into this trip. */
export function PoiCard({ place, tripId, below, onClose }: { place: MapPlace; tripId: string; below?: boolean; onClose: () => void }) {
  const group = poiGroup(place.poi?.cls, place.poi?.sub);
  return (
    <div className="map-add" data-below={below || undefined} {...keep}>
      <div className="map-add-card poi-card" role="dialog" aria-label={place.name} style={{ "--k": POI_COLOR[group] } as React.CSSProperties}>
        <div className="flex items-start gap-2">
          <span className="poi-card-dot" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="t-micro text-text-3">{poiLabel(place.poi?.cls, place.poi?.sub)}</p>
            <p className="font-semibold leading-tight">{place.name}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm -mr-1.5 -mt-1" aria-label="Close" onClick={onClose}><X size={14} aria-hidden /></button>
        </div>
        <div className="mt-2.5">
          <PlaceToTrip place={place} tripId={tripId} />
        </div>
        <a className="poi-card-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name} ${place.lat.toFixed(5)},${place.lng.toFixed(5)}`)}`} target="_blank" rel="noopener noreferrer">
          <Navigation size={12} aria-hidden /> Open in Maps
        </a>
      </div>
      <span className="map-add-dot" aria-hidden />
    </div>
  );
}
