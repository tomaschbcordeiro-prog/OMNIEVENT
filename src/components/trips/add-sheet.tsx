"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, BedDouble, Briefcase, Landmark, Loader2, MapPin, NotebookPen, Plane, Plus, Search, Sparkles, TrainFront, UtensilsCrossed, X } from "lucide-react";
import { userActions, type Trip } from "@/lib/user/store";
import { addDays, daysOf, placeName, stopColor, type TripStop } from "@/lib/trip";
import { haversineKm } from "@/lib/geo";
import { kindLabel, parsePlan, splitWhen, type PlanKind, type TripPlan } from "@/lib/trip-plans";
import { planKindForPoi, POI_COLOR, poiGroup, poiLabel } from "@/lib/pois";
import type { Sight } from "@/lib/sights";
import type { TripEvent } from "@/lib/trip-snap";
import { toast } from "../toast";
import { announcePlan, PlanForm, type Draft } from "./agenda";
import { KIND_ICON } from "./plan-icons";
import { WhenPicker, type PlaceDraft, type WhenValue } from "./when-picker";
import type { AddKind, AddRequest } from "./add-bus";

/*
 * The trip's one way to add anything: a sheet with what can go in (a place to see, food and
 * drink, where you sleep, a flight, a train, a meeting, an event, a note), one search for places
 * and plans ("Café Nicola", "dinner 20:30"), the city's best-known sights a tap away, then when
 * (the day, a time that suits it, how long) or the details (a flight's number and times).
 *
 * On a phone it takes the whole screen, and only the part above the keyboard: what's typed and
 * what's found are always in view.
 */

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const dayName = (d: string) => fmt(d, { weekday: "short", day: "numeric", month: "short" });
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 12) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`);

export interface Found {
  name: string;
  context?: string;
  lat: number;
  lng: number;
  poi?: { cls: string; sub?: string };
}

/** A city's best-known sights (from Wikipedia), once per city. */
export function useSights(stop: TripStop | undefined) {
  const [sights, setSights] = useState<Sight[] | null>(null);
  const lat = stop?.lat;
  const lng = stop?.lng;
  useEffect(() => {
    if (lat == null || lng == null) return;
    const ctrl = new AbortController();
    setSights(null);
    fetch(`/api/places/top?lat=${lat.toFixed(3)}&lng=${lng.toFixed(3)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { sights: [] }))
      .then((j: { sights: Sight[] }) => setSights(j.sights))
      .catch(() => setSights((s) => s ?? []));
    return () => ctrl.abort();
  }, [lat, lng]);
  return sights;
}

/** Places matching words, near a city. */
function usePlaces(stop: TripStop | undefined, query: string) {
  const [found, setFound] = useState<Found[]>([]);
  const [busy, setBusy] = useState(false);
  const lat = stop?.lat;
  const lng = stop?.lng;
  useEffect(() => {
    setFound([]);
    if (query.length < 3 || lat == null || lng == null) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      setBusy(true);
      fetch(`/api/geocode?q=${encodeURIComponent(query)}&lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&limit=10&lang=en`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((j: { results: Found[] }) => {
          const seen = new Set<string>();
          setFound(j.results.filter((r) => haversineKm(r.lat, r.lng, lat, lng) <= 40 && !seen.has(`${r.name}|${r.context}`) && seen.add(`${r.name}|${r.context}`)).slice(0, 7));
        })
        .catch(() => {})
        .finally(() => setBusy(false));
    }, 250);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, lat, lng]);
  return { found, busy };
}

/** The same place on the trip already. */
export const planFor = (trip: Trip, lat: number, lng: number, name: string) => trip.plans?.find((p) => p.lat != null && p.lng != null && ((Math.abs(p.lat - lat) < 0.0008 && Math.abs(p.lng - lng) < 0.0008) || (p.title === name && haversineKm(p.lat, p.lng, lat, lng) < 1)));

/** A place being put on the trip: what it is, and when, as far as it's known. */
export interface Picking {
  draft: PlaceDraft;
  initial?: Partial<WhenValue>;
  /** Its street or area, kept with it. */
  place?: string;
  /** On the trip already: this changes it. */
  existing?: TripPlan;
  /** Chosen with the keyboard: Enter again adds it. */
  focusSave?: boolean;
}

export const kindFor = (cls?: string, sub?: string): PlanKind => {
  const k = cls ? planKindForPoi(poiGroup(cls, sub)) : "visit";
  return k === "note" ? "visit" : k;
};
export const sightDraft = (s: Sight): PlaceDraft => ({ title: s.name, kind: kindFor(s.cls), lat: s.lat, lng: s.lng, poi: s.cls, about: s.about, image: s.image });
export const foundDraft = (f: Found): PlaceDraft => ({
  title: f.name,
  kind: kindFor(f.poi?.cls, f.poi?.sub),
  lat: f.lat,
  lng: f.lng,
  ...(f.poi ? { poi: f.poi.sub && f.poi.sub !== f.poi.cls ? `${f.poi.cls}/${f.poi.sub}` : f.poi.cls } : {}),
  about: [f.poi ? poiLabel(f.poi.cls, f.poi.sub) : "", f.context?.split(",").slice(0, 2).join(",")].filter(Boolean).join(" · "),
});
/** Picking a place that's on the trip already opens it, to change when. */
export const pickingFor = (trip: Trip, draft: PlaceDraft, initial?: Partial<WhenValue>, place?: string, focusSave?: boolean): Picking => {
  const existing = draft.lat != null && draft.lng != null ? planFor(trip, draft.lat, draft.lng, draft.title) : undefined;
  return existing ? { draft: { ...draft, kind: existing.kind }, existing, initial: existing, focusSave } : { draft, initial, place, focusSave };
};

/** A place picked (and when) into the trip, or a change to one on it already. Its plan's id. */
export function addPicked(trip: Trip, stop: TripStop, p: Picking, w: WhenValue, el: HTMLElement | null): string {
  const from = el?.getBoundingClientRect();
  const when = dayName(w.day || stop.from);
  const said = w.day ? `${p.draft.kind === "stay" && w.endDay ? `${when} → ${dayName(w.endDay)}` : when}${w.time ? `, ${w.time}` : ""}` : "a place to see";
  let id: string;
  if (p.existing) {
    const before = p.existing;
    id = before.id;
    announcePlan(id, from);
    userActions.updatePlan(trip.id, id, { day: w.day, time: w.time, endTime: w.endTime, endDay: w.endDay, notes: w.notes });
    toast({ title: `${before.title}: ${said}`, emoji: "🗓️", action: { label: "Undo", run: () => userActions.updatePlan(trip.id, before.id, before) } });
  } else {
    id = newId();
    announcePlan(id, from);
    userActions.addPlan(trip.id, { id, kind: p.draft.kind, title: p.draft.title.slice(0, 80), ...w, lat: p.draft.lat, lng: p.draft.lng, ...(p.draft.poi ? { poi: p.draft.poi } : {}), ...(p.place ? { place: p.place } : {}), ...(p.draft.image?.startsWith("https://") ? { image: p.draft.image } : {}), createdAt: new Date().toISOString() });
    const nid = id;
    toast({ title: `Added to ${placeName(stop)}`, body: `${p.draft.title}, ${said}`, emoji: "📍", action: { label: "Undo", run: () => userActions.removePlan(trip.id, nid) } });
  }
  try {
    navigator.vibrate?.(8);
  } catch {
    // no vibration here
  }
  return id;
}

/** What can go in, as tiles. */
const TILES: { kind: AddKind | "event"; label: string; sub: string; Icon: typeof Plane; color: string }[] = [
  { kind: "place", label: "Place to see", sub: "Museum, monument, park", Icon: Landmark, color: "#c2650a" },
  { kind: "food", label: "Food & drink", sub: "Restaurant, café, bar", Icon: UtensilsCrossed, color: "#e5484d" },
  { kind: "stay", label: "Where you sleep", sub: "Hotel, flat, friends", Icon: BedDouble, color: "#7b4dff" },
  { kind: "flight", label: "Flight", sub: "Number, times", Icon: Plane, color: "#1463ff" },
  { kind: "train", label: "Train, bus, car", sub: "Getting around", Icon: TrainFront, color: "#0f9f73" },
  { kind: "meeting", label: "Meeting", sub: "Work, friends", Icon: Briefcase, color: "#d63384" },
  { kind: "event", label: "An event", sub: "What's on there", Icon: Sparkles, color: "#0a94c9" },
  { kind: "note", label: "Note", sub: "A reminder", Icon: NotebookPen, color: "#8a93a6" },
];
const SEARCH_HINT: Record<"place" | "food" | "stay", { label: string; placeholder: string; Icon: typeof Plane }> = {
  place: { label: "Places to see", placeholder: "A museum, a monument, a park…", Icon: Landmark },
  food: { label: "Food & drink", placeholder: "A restaurant, a café, a bar…", Icon: UtensilsCrossed },
  stay: { label: "Where you sleep", placeholder: "Your hotel's name…", Icon: BedDouble },
};

const TRAVEL: PlanKind[] = ["flight", "train", "bus", "car"];

type Step = { s: "home" } | { s: "when"; picking: Picking; own?: Draft } | { s: "form"; draft: Draft; edit?: TripPlan };
type Option = { key: string; kind: "sight"; s: Sight } | { key: string; kind: "place"; f: Found } | { key: string; kind: "own"; p: Draft };

export function AddSheet({
  trip,
  stops,
  events,
  req,
  near,
  onClose,
  onDone,
}: {
  trip: Trip;
  stops: TripStop[];
  events: { e: TripEvent; day: string }[];
  req: AddRequest;
  /** The city on screen, when the request doesn't say. */
  near?: TripStop;
  onClose: () => void;
  /** Something went in (or changed): its plan's id. */
  onDone?: (id: string) => void;
}) {
  const ownerOf = (d?: string | null) => (d ? stops.findIndex((s, k) => s.from <= d && (d < s.to || (k === stops.length - 1 && d <= s.to))) : -1);
  const [si, setSi] = useState(() => {
    const byId = req.stopId ? stops.findIndex((s) => s.id === req.stopId) : -1;
    if (byId >= 0) return byId;
    const byDay = ownerOf(req.day ?? req.edit?.day);
    if (byDay >= 0) return byDay;
    const e = req.edit;
    if (e?.lat != null && e.lng != null) {
      const k = stops.findIndex((s) => haversineKm(s.lat, s.lng, e.lat!, e.lng!) < 40);
      if (k >= 0) return k;
    }
    const n = near ? stops.findIndex((s) => s.id === near.id) : -1;
    return Math.max(0, n);
  });
  const stop = stops[si];
  const [day, setDay] = useState<string | null>(req.day ?? null);
  const tripDays = useMemo(() => (stops.length ? daysOf(stops[0].from, stops[stops.length - 1].to) : []), [stops]);
  const days = useMemo(() => (stop ? daysOf(stop.from, stop.to) : tripDays), [stop, tripDays]);

  const formFor = (k: "flight" | "train" | "meeting" | "note"): Draft => {
    const prev = stops[si - 1];
    if (k === "flight" || k === "train") return { kind: k, title: stop ? `${kindLabel(k)} to ${stop.name}` : kindLabel(k), day: day ?? stop?.from ?? "", ...(prev ? { from: prev.name } : {}), ...(stop ? { to: stop.name } : {}) };
    if (k === "meeting") return { kind: "meeting", title: "", day: day ?? stop?.from ?? "" };
    return { kind: "note", title: "", day: day ?? "" };
  };
  const [step, setStep] = useState<Step>(() => {
    if (req.edit) {
      const e = req.edit;
      if (e.lat != null && e.lng != null) return { s: "when", picking: { draft: { title: e.title, kind: e.kind, lat: e.lat, lng: e.lng, poi: e.poi, image: e.image, about: e.place }, existing: e, initial: e } };
      return { s: "form", draft: e, edit: e };
    }
    if (req.picking) return { s: "when", picking: req.picking };
    if (req.draft) return { s: "form", draft: req.draft };
    if (req.kind === "flight" || req.kind === "train" || req.kind === "meeting" || req.kind === "note") return { s: "form", draft: formFor(req.kind) };
    return { s: "home" };
  });
  const [hint, setHint] = useState<"place" | "food" | "stay" | null>(req.kind === "place" || req.kind === "food" || req.kind === "stay" ? req.kind : null);
  const [q, setQ] = useState(req.query ?? "");
  const [hi, setHi] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const sights = useSights(stop);

  // On a phone, the sheet is the part of the screen above the keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    const el = panel.current;
    if (!vv || !el) return;
    const set = () => {
      el.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
      el.style.setProperty("--vvt", `${Math.round(vv.offsetTop)}px`);
    };
    set();
    vv.addEventListener("resize", set);
    vv.addEventListener("scroll", set);
    return () => {
      vv.removeEventListener("resize", set);
      vv.removeEventListener("scroll", set);
    };
  }, []);
  // The keyboard comes into the sheet (whatever opened it), and Escape works from anywhere.
  useEffect(() => {
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true });
    const back = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || panel.current?.contains(e.target as Node)) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", back, true);
    return () => window.removeEventListener("keydown", back, true);
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Typing straight away on a computer, or when a kind of place was asked for.
  useEffect(() => {
    if (step.s !== "home") return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (!coarse || hint || q) input.current?.focus({ preventScroll: true });
  }, [step.s, hint]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the search
  const said = useMemo(() => splitWhen(q, { days, defaultDay: day ?? stop?.from ?? "" }), [q, days, day, stop?.from]);
  const { found, busy } = usePlaces(stop, said.query);
  const t = plain(said.query);
  const mine = t.length >= 2 ? (sights ?? []).filter((s) => plain(s.name).includes(t)).slice(0, 3) : [];
  const places = found.filter((f) => !mine.some((s) => haversineKm(s.lat, s.lng, f.lat, f.lng) < 0.15));
  let own: Draft | null = q.trim().length >= 2 && stop ? parsePlan(q, { days, defaultDay: day ?? stop.from }) : null;
  if (own && hint === "stay") own = { ...own, kind: "stay", title: own.place && /^(hotel|stay)$/i.test(own.title) ? own.place : own.title, endDay: own.endDay ?? addDays(own.day, 1) };
  if (own && hint === "food" && (own.kind === "activity" || own.kind === "visit")) own = { ...own, kind: "meal" };
  const options: Option[] = [...mine.map((s): Option => ({ key: `s${s.id}`, kind: "sight", s })), ...places.map((f, i): Option => ({ key: `f${i}${f.name}`, kind: "place", f })), ...(own ? [{ key: "own", kind: "own", p: own } as Option] : [])];

  const typed = { ...(said.day || day ? { day: said.day ?? day ?? undefined } : {}), ...(said.time ? { time: said.time } : {}), ...(said.endTime ? { endTime: said.endTime } : {}) };
  const shape = (d: PlaceDraft): PlaceDraft => (hint === "stay" ? { ...d, kind: "stay" } : hint === "food" && (d.kind === "visit" || d.kind === "activity") ? { ...d, kind: "meal" } : d);
  const choose = (o: Option, keyboard = false) => {
    if (o.kind === "own") {
      const p = o.p;
      setStep({ s: "when", own: p, picking: { draft: { title: p.title, kind: p.kind, about: [p.place, p.from && p.to ? `${p.from} → ${p.to}` : ""].filter(Boolean).join(" · ") || undefined }, initial: { day: p.day, time: p.time, endTime: p.endTime, endDay: p.endDay }, focusSave: keyboard } });
      return;
    }
    const d = o.kind === "sight" ? sightDraft(o.s) : foundDraft(o.f);
    setStep({ s: "when", picking: pickingFor(trip, shape(d), typed, o.kind === "place" ? o.f.context?.split(",")[0].slice(0, 80) : undefined, keyboard) });
  };

  // ---- done
  const finish = (id: string) => {
    onDone?.(id);
    onClose();
  };
  const saveWhen = (picking: Picking, w: WhenValue, el: HTMLElement | null, ownDraft?: Draft) => {
    if (!stop) return;
    if (ownDraft && !picking.existing) {
      const id = newId();
      announcePlan(id, el?.getBoundingClientRect());
      const plan: TripPlan = { ...ownDraft, title: ownDraft.title.slice(0, 80), day: w.day, time: w.time, endTime: w.endTime, endDay: w.endDay ?? (ownDraft.kind === "stay" ? ownDraft.endDay : undefined), notes: w.notes, id, createdAt: new Date().toISOString() };
      userActions.addPlan(trip.id, plan);
      toast({ title: `${kindLabel(plan.kind)} added`, body: `${plan.title}${plan.day ? `, ${dayName(plan.day)}${plan.time ? ` ${plan.time}` : ""}` : ""}`, emoji: "🗓️", action: { label: "Undo", run: () => userActions.removePlan(trip.id, id) } });
      return finish(id);
    }
    finish(addPicked(trip, stop, picking, w, el));
  };
  const saveForm = (d: Draft, edit?: TripPlan) => {
    if (!d.title.trim()) return;
    if (edit) {
      userActions.updatePlan(trip.id, edit.id, { ...d, title: d.title.trim() });
      announcePlan(edit.id);
      toast({ title: `${d.title.trim()} changed`, emoji: "🗓️", action: { label: "Undo", run: () => userActions.updatePlan(trip.id, edit.id, edit) } });
      return finish(edit.id);
    }
    const id = newId();
    announcePlan(id);
    userActions.addPlan(trip.id, { ...d, title: d.title.trim(), id, createdAt: new Date().toISOString() });
    toast({ title: `${kindLabel(d.kind)} added`, body: `${d.title.trim()}${d.day ? `, ${dayName(d.day)}${d.time ? ` ${d.time}` : ""}` : ""}`, emoji: "🗓️", action: { label: "Undo", run: () => userActions.removePlan(trip.id, id) } });
    finish(id);
  };
  const remove = (p: TripPlan) => {
    userActions.removePlan(trip.id, p.id);
    toast({ title: `${p.title} taken off`, emoji: "🗑️", action: { label: "Undo", run: () => userActions.addPlan(trip.id, p) } });
    onClose();
  };

  const back = () => {
    if (step.s !== "home" && !req.edit && !req.picking && !req.draft && !(req.kind && ["flight", "train", "meeting", "note"].includes(req.kind))) setStep({ s: "home" });
    else if (step.s === "home" && (hint || q)) {
      setHint(null);
      setQ("");
    } else onClose();
  };
  const tile = (k: AddKind | "event") => {
    if (k === "place" || k === "food" || k === "stay") {
      setHint(k);
      setHi(0);
      input.current?.focus();
    } else if (k !== "event") setStep({ s: "form", draft: formFor(k) });
  };
  const eventsLink = stop ? `/events?${new URLSearchParams({ lat: stop.lat.toFixed(4), lng: stop.lng.toFixed(4), radius: "30", pl: placeName(stop), from: stop.from, to: stop.to })}` : "/events";

  // Keys: Escape steps back; Tab stays inside.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      back();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const f = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input, textarea, select")].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) {
      e.preventDefault();
      f[f.length - 1].focus();
    } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
      e.preventDefault();
      f[0].focus();
    }
  };

  const title =
    step.s === "form" ? (step.edit ? `Change ${step.edit.title}` : `Add a ${kindLabel(step.draft.kind).toLowerCase()}`) : step.s === "when" ? (step.picking.existing ? `Change ${step.picking.draft.title}` : "When?") : `Add to ${trip.name}`;
  const searching = step.s === "home" && (q.trim().length > 0 || !!hint);
  const H = hint ? SEARCH_HINT[hint] : null;

  return createPortal(
    <div className="addx" onKeyDown={onKeyDown}>
      <div className="addx-scrim" onClick={onClose} aria-hidden />
      <div ref={panel} className="addx-panel" role="dialog" aria-modal="true" aria-labelledby="addx-title" tabIndex={-1}>
        <header className="addx-head">
          {step.s !== "home" || searching ? (
            <button type="button" className="addx-icon" aria-label="Back" onClick={back}><ArrowLeft size={19} aria-hidden /></button>
          ) : (
            <span className="addx-plus" aria-hidden><Plus size={18} /></span>
          )}
          <h2 id="addx-title" className="addx-title">{title}</h2>
          <button type="button" className="addx-icon" aria-label="Close" onClick={onClose}><X size={19} aria-hidden /></button>
        </header>

        {step.s === "home" && (
          <>
            {/* Where, and the day, when there's a choice. */}
            {(stops.length > 1 || day) && (
              <div className="addx-where" role="group" aria-label="For">
                {stops.length > 1 &&
                  stops.map((s, i) => (
                    <button key={s.id} type="button" className="addx-city" aria-pressed={i === si} style={{ "--c": stopColor(i) } as React.CSSProperties} onClick={() => {
                        setSi(i);
                        if (day && ownerOf(day) !== i) setDay(null);
                      }}>
                      <span className="addx-city-n" aria-hidden>{i + 1}</span> {s.name}
                    </button>
                  ))}
                {day && (
                  <span className="ag-on">
                    {dayName(day)}
                    <button type="button" aria-label="Any day" onClick={() => setDay(null)}><X size={12} aria-hidden /></button>
                  </span>
                )}
              </div>
            )}
            <div className="addx-search">
              <Search size={17} aria-hidden className="shrink-0 text-text-3" />
              {H && (
                <span className="addx-hint">
                  <H.Icon size={13} aria-hidden /> <span className="addx-hint-l">{H.label}</span>
                  <button type="button" aria-label={`Not only ${H.label.toLowerCase()}`} onClick={() => (setHint(null), input.current?.focus())}><X size={12} aria-hidden /></button>
                </span>
              )}
              <input
                ref={input}
                value={q}
                onChange={(e) => (setQ(e.target.value), setHi(0))}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHi((h) => Math.min(options.length - 1, h + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHi((h) => Math.max(0, h - 1));
                  } else if (e.key === "Enter" && options[hi]) {
                    e.preventDefault();
                    choose(options[hi], true);
                  }
                }}
                placeholder={H ? H.placeholder : stop ? `Search ${stop.name}, or type “dinner 20:30”` : "Type what to add"}
                aria-label={`Search a place${stop ? ` in ${stop.name}` : ""}, or type a plan`}
                role="combobox"
                aria-expanded={options.length > 0}
                aria-controls="addx-opts"
                aria-activedescendant={options[hi] ? `addx-opt-${hi}` : undefined}
                autoComplete="off"
                enterKeyHint="search"
              />
              {busy ? <Loader2 size={16} className="animate-spin text-text-3 shrink-0" aria-hidden /> : q ? (
                <button type="button" className="addx-clear" aria-label="Clear" onClick={() => (setQ(""), input.current?.focus())}><X size={14} aria-hidden /></button>
              ) : null}
            </div>
          </>
        )}

        <div className="addx-body">
          {step.s === "home" && !searching && (
            <>
              <p className="addx-h">What do you want to add?</p>
              <ul className="addx-tiles">
                {TILES.map(({ kind, label, sub, Icon, color }) => (
                  <li key={kind}>
                    {kind === "event" ? (
                      <Link href={eventsLink} className="addx-tile" style={{ "--k": color } as React.CSSProperties} onClick={onClose}>
                        <span className="addx-tile-i" aria-hidden><Icon size={20} /></span>
                        <span className="addx-tile-l">{label}</span>
                        <span className="addx-tile-s">{sub}</span>
                      </Link>
                    ) : (
                      <button type="button" className="addx-tile" style={{ "--k": color } as React.CSSProperties} onClick={() => tile(kind)}>
                        <span className="addx-tile-i" aria-hidden><Icon size={20} /></span>
                        <span className="addx-tile-l">{label}</span>
                        <span className="addx-tile-s">{sub}</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {stop && sights && sights.length > 0 && (
                <>
                  <p className="addx-h mt-5">Top sights in {stop.name}</p>
                  <ul className="addx-list">
                    {sights.slice(0, 6).map((s) => {
                      const on = planFor(trip, s.lat, s.lng, s.name);
                      return (
                        <li key={s.id}>
                          <button type="button" className="addx-row" onClick={() => setStep({ s: "when", picking: pickingFor(trip, sightDraft(s), day ? { day } : undefined) })}>
                            {s.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={s.image} alt="" className="addx-row-img" loading="lazy" />
                            ) : (
                              <span className="addx-row-dot" style={{ "--k": POI_COLOR[poiGroup(s.cls)] } as React.CSSProperties} aria-hidden><Landmark size={15} /></span>
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="addx-row-t">{s.name}</span>
                              <span className="addx-row-s">{on ? (on.day ? `On ${dayName(on.day)}${on.time ? ` ${on.time}` : ""}` : "On your list") : s.about}</span>
                            </span>
                            <span className="addx-row-add" data-on={on ? "" : undefined} aria-hidden>{on ? "Change" : <Plus size={16} />}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </>
          )}

          {step.s === "home" && searching && (
            <>
              {options.length > 0 ? (
                <ul id="addx-opts" role="listbox" className="addx-list" aria-label="Results">
                  {options.map((o, i) => (
                    // Options of a combobox: chosen from the line (arrows, Enter) or tapped.
                    <li key={o.key} id={`addx-opt-${i}`} role="option" aria-selected={i === hi} className="addx-row" data-hi={i === hi || undefined} onMouseDown={(e) => e.preventDefault()} onMouseMove={() => i !== hi && setHi(i)} onClick={() => choose(o)}>
                      {o.kind === "own" ? (
                        <>
                          <span className="addx-row-dot" data-kind={o.p.kind} aria-hidden>{(() => { const I = KIND_ICON[o.p.kind]; return <I size={15} />; })()}</span>
                          <span className="min-w-0 flex-1">
                            <span className="addx-row-t">Add “{o.p.title}”</span>
                            <span className="addx-row-s">{[kindLabel(o.p.kind), o.p.day ? `${dayName(o.p.day)}${o.p.time ? ` ${o.p.time}` : ""}` : "", o.p.place].filter(Boolean).join(" · ")}</span>
                          </span>
                          <span className="addx-row-tag">Your own</span>
                        </>
                      ) : (
                        <>
                          {o.kind === "sight" && o.s.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={o.s.image} alt="" className="addx-row-img" loading="lazy" />
                          ) : (
                            <span className="addx-row-dot" style={{ "--k": POI_COLOR[poiGroup(o.kind === "sight" ? o.s.cls : o.f.poi?.cls, o.kind === "place" ? o.f.poi?.sub : undefined)] } as React.CSSProperties} aria-hidden>
                              <MapPin size={15} />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="addx-row-t">{o.kind === "sight" ? o.s.name : o.f.name}</span>
                            <span className="addx-row-s">{o.kind === "sight" ? o.s.about : [o.f.poi ? poiLabel(o.f.poi.cls, o.f.poi.sub) : "", o.f.context].filter(Boolean).join(" · ")}</span>
                          </span>
                          <span className="addx-row-add" aria-hidden><Plus size={16} /></span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="addx-empty">{busy ? "Looking…" : q.trim().length < 2 ? (H ? `Type its name${stop ? ` in ${stop.name}` : ""}.` : "Type a place or a plan.") : "Nothing found yet. Keep typing, or add it as your own."}</p>
              )}
              {!q.trim() && hint && (
                <p className="addx-tip">Tip: put the day and time in too, like “{hint === "food" ? "Ramiro friday 20:30" : hint === "stay" ? "Memmo Alfama" : "Gulbenkian sat 10:00"}”.</p>
              )}
            </>
          )}

          {step.s === "when" && stop && (
            <WhenPicker
              key={step.picking.draft.title}
              trip={trip}
              draft={step.picking.draft}
              days={step.picking.draft.kind === "stay" ? tripDays : days}
              initial={step.picking.initial}
              events={events}
              verb={step.picking.existing ? "Save" : "Add"}
              skip={step.picking.existing?.id}
              focusSave={step.picking.focusSave}
              onCancel={back}
              onRemove={step.picking.existing ? () => remove(step.picking.existing!) : undefined}
              onSave={(w, el) => saveWhen(step.picking, w, el, step.own)}
            />
          )}

          {step.s === "form" && (
            <PlanForm
              draft={step.draft}
              days={tripDays}
              kinds={step.edit ? undefined : TRAVEL.includes(step.draft.kind) ? TRAVEL : []}
              onChange={(d) => setStep({ ...step, draft: d })}
              onCancel={back}
              onDelete={step.edit ? () => remove(step.edit!) : undefined}
              onSave={() => saveForm(step.draft, step.edit)}
              saveLabel={step.edit ? "Save" : "Add to trip"}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
