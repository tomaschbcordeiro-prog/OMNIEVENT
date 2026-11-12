"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Landmark, Loader2, MapPin, Plus, Search, X } from "lucide-react";
import type { EventCard } from "@/lib/types";
import { userActions, type Trip } from "@/lib/user/store";
import { daysOf, flagOf, nightsBetween, placeName, STOP_RADIUS_KM, stopColor, type TripStop } from "@/lib/trip";
import { haversineKm } from "@/lib/geo";
import { isScheduled, isTravel, kindLabel, parsePlan, splitWhen, type PlanKind, type TripPlan } from "@/lib/trip-plans";
import { planKindForPoi, POI_COLOR, poiGroup, poiLabel } from "@/lib/pois";
import type { Sight } from "@/lib/sights";
import { formatEventTime, localDateKey } from "@/lib/format";
import type { TripEvent } from "@/lib/trip-snap";
import { Poster } from "../ui";
import { toast } from "../toast";
import { announcePlan, PLAN_DRAG, TripAgenda } from "./agenda";
import { KIND_ICON } from "./plan-icons";
import { WhenPicker, type PlaceDraft, type WhenValue } from "./when-picker";

/*
 * A city of a trip, as one page of everything you're going to do there: what's planned day
 * by day, the places you want to see, its best-known sights to add in a tap, one search for
 * anything (a museum, a restaurant, "dinner 20:30"), and what's on while you're there.
 */

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const dayName = (d: string) => fmt(d, { weekday: "short", day: "numeric", month: "short" });
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 12) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`);

interface Found {
  name: string;
  context?: string;
  lat: number;
  lng: number;
  poi?: { cls: string; sub?: string };
}

/** A city's best-known sights (from Wikipedia), once per city. */
function useSights(stop: TripStop) {
  const [sights, setSights] = useState<Sight[] | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    setSights(null);
    fetch(`/api/places/top?lat=${stop.lat.toFixed(3)}&lng=${stop.lng.toFixed(3)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { sights: [] }))
      .then((j: { sights: Sight[] }) => setSights(j.sights))
      .catch(() => setSights((s) => s ?? []));
    return () => ctrl.abort();
  }, [stop.lat, stop.lng]);
  return sights;
}

/** The same place on the trip already. */
const planFor = (trip: Trip, lat: number, lng: number, name: string) => trip.plans?.find((p) => p.lat != null && p.lng != null && ((Math.abs(p.lat - lat) < 0.0008 && Math.abs(p.lng - lng) < 0.0008) || (p.title === name && haversineKm(p.lat, p.lng, lat, lng) < 1)));

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

const kindFor = (cls?: string, sub?: string): PlanKind => {
  const k = cls ? planKindForPoi(poiGroup(cls, sub)) : "visit";
  return k === "note" ? "visit" : k;
};
const sightDraft = (s: Sight): PlaceDraft => ({ title: s.name, kind: kindFor(s.cls), lat: s.lat, lng: s.lng, poi: s.cls, about: s.about, image: s.image });
const foundDraft = (f: Found): PlaceDraft => ({
  title: f.name,
  kind: kindFor(f.poi?.cls, f.poi?.sub),
  lat: f.lat,
  lng: f.lng,
  ...(f.poi ? { poi: f.poi.sub && f.poi.sub !== f.poi.cls ? `${f.poi.cls}/${f.poi.sub}` : f.poi.cls } : {}),
  about: [f.poi ? poiLabel(f.poi.cls, f.poi.sub) : "", f.context?.split(",").slice(0, 2).join(",")].filter(Boolean).join(" · "),
});
/** Picking a place that's on the trip already opens it, to change when. */
const pickingFor = (trip: Trip, draft: PlaceDraft, initial?: Partial<WhenValue>, place?: string, focusSave?: boolean): Picking => {
  const existing = draft.lat != null && draft.lng != null ? planFor(trip, draft.lat, draft.lng, draft.title) : undefined;
  return existing ? { draft: { ...draft, kind: existing.kind }, existing, initial: existing, focusSave } : { draft, initial, place, focusSave };
};

/** One search for anything to do in the city: its sights, any place there, or a plan of your own. */
function CityAdd({
  trip,
  stop,
  sights,
  day,
  onDay,
  input,
  events,
  picking,
  onPick,
  onSave,
}: {
  trip: Trip;
  stop: TripStop;
  sights: Sight[];
  day: string | null;
  onDay: (d: string | null) => void;
  input: React.RefObject<HTMLInputElement | null>;
  events: { e: TripEvent; day: string }[];
  picking: Picking | null;
  onPick: (p: Picking | null) => void;
  onSave: (p: Picking, w: WhenValue, el: HTMLElement | null) => void;
}) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [busy, setBusy] = useState(false);
  const [hi, setHi] = useState(0);
  const days = useMemo(() => daysOf(stop.from, stop.to), [stop.from, stop.to]);
  // "Café Nicola wed 10:00": search for the café, keep the day and the time for it.
  const said = useMemo(() => splitWhen(q, { days, defaultDay: day ?? stop.from }), [q, days, day, stop.from]);
  useEffect(() => {
    const t = said.query;
    setFound([]);
    if (t.length < 3) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      setBusy(true);
      fetch(`/api/geocode?q=${encodeURIComponent(t)}&lat=${stop.lat.toFixed(4)}&lng=${stop.lng.toFixed(4)}&limit=8&lang=en`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((j: { results: Found[] }) => {
          const seen = new Set<string>();
          setFound(j.results.filter((r) => haversineKm(r.lat, r.lng, stop.lat, stop.lng) <= 40 && !seen.has(`${r.name}|${r.context}`) && seen.add(`${r.name}|${r.context}`)).slice(0, 5));
        })
        .catch(() => {})
        .finally(() => setBusy(false));
    }, 280);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [said.query, stop.lat, stop.lng]);

  const t = plain(said.query);
  const mine = t.length >= 2 ? sights.filter((s) => plain(s.name).includes(t)).slice(0, 3) : [];
  const places = found.filter((f) => !mine.some((s) => haversineKm(s.lat, s.lng, f.lat, f.lng) < 0.15));
  const plan = q.trim().length >= 2 ? parsePlan(q, { days, defaultDay: day ?? stop.from }) : null;
  type Option = { key: string; kind: "sight"; s: Sight } | { key: string; kind: "place"; f: Found } | { key: string; kind: "plan"; p: NonNullable<typeof plan> };
  const options: Option[] = [
    ...mine.map((s): Option => ({ key: `s${s.id}`, kind: "sight", s })),
    ...places.map((f, i): Option => ({ key: `f${i}${f.name}`, kind: "place", f })),
    ...(plan ? [{ key: "plan", kind: "plan", p: plan } as Option] : []),
  ];

  const choose = (o: Option, el: Element | null, keyboard = false) => {
    if (o.kind === "plan") {
      const id = newId();
      announcePlan(id, el?.getBoundingClientRect());
      userActions.addPlan(trip.id, { ...o.p, id, createdAt: new Date().toISOString() });
      toast({ title: `Added to ${placeName(stop)}`, body: `${o.p.title}, ${dayName(o.p.day)}${o.p.time ? ` ${o.p.time}` : ""}`, emoji: "🗓️", action: { label: "Undo", run: () => userActions.removePlan(trip.id, id) } });
      setQ("");
      setHi(0);
      onDay(null);
      return;
    }
    const initial = { ...(said.day || day ? { day: said.day ?? day ?? undefined } : {}), ...(said.time ? { time: said.time } : {}), ...(said.endTime ? { endTime: said.endTime } : {}) };
    onPick(o.kind === "sight" ? pickingFor(trip, sightDraft(o.s), initial, undefined, keyboard) : pickingFor(trip, foundDraft(o.f), initial, o.f.context?.split(",")[0].slice(0, 80), keyboard));
  };

  return (
    <div className="city-add">
      <div className="city-add-line">
        <Search size={16} aria-hidden className="shrink-0 text-text-3" />
        {day && (
          <span className="ag-on">
            {dayName(day)}
            <button type="button" aria-label="Any day" onClick={() => onDay(null)}><X size={12} aria-hidden /></button>
          </span>
        )}
        <input
          ref={input}
          value={q}
          onChange={(e) => (setQ(e.target.value), setHi(0), picking && onPick(null))}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => Math.min(options.length - 1, h + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(0, h - 1));
            } else if (e.key === "Enter" && options[hi]) {
              e.preventDefault();
              choose(options[hi], document.getElementById(`city-opt-${hi}`), true);
            } else if (e.key === "Escape") {
              setQ("");
              onDay(null);
              onPick(null);
            }
          }}
          placeholder={`Add to ${placeName(stop)}: a sight, a restaurant, “dinner 20:30”…`}
          aria-label={`Add something to do in ${placeName(stop)}: a sight, a place, or a plan of your own`}
          role="combobox"
          aria-expanded={options.length > 0 && !picking}
          aria-controls="city-opts"
          aria-activedescendant={options[hi] ? `city-opt-${hi}` : undefined}
          autoComplete="off"
          enterKeyHint="done"
        />
        {busy && <Loader2 size={15} className="animate-spin text-text-3 shrink-0" aria-hidden />}
      </div>
      {picking && (
        <WhenPicker
          key={`${picking.draft.title}|${picking.draft.lat}`}
          trip={trip}
          draft={picking.draft}
          days={days}
          initial={picking.initial}
          events={events}
          verb={picking.existing ? "Save" : "Add"}
          skip={picking.existing?.id}
          focusSave={picking.focusSave}
          onCancel={() => onPick(null)}
          onRemove={
            picking.existing
              ? () => {
                  const gone = picking.existing!;
                  userActions.removePlan(trip.id, gone.id);
                  onPick(null);
                  toast({ title: `${gone.title} taken off`, emoji: "🗑️", action: { label: "Undo", run: () => userActions.addPlan(trip.id, gone) } });
                }
              : undefined
          }
          onSave={(w, el) => {
            onSave(picking, w, el);
            setQ("");
            setHi(0);
          }}
        />
      )}
      {options.length > 0 && !picking && (
        <ul id="city-opts" role="listbox" className="city-opts" aria-label="Add to the trip">
          {options.map((o, i) => (
            // The options of a combobox: chosen from the line (arrows, Enter) or tapped, never focused.
            <li key={o.key} id={`city-opt-${i}`} role="option" aria-selected={i === hi} className="city-opt" data-hi={i === hi || undefined} onMouseDown={(e) => e.preventDefault()} onMouseMove={() => i !== hi && setHi(i)} onClick={(e) => choose(o, e.currentTarget)}>
                {o.kind === "plan" ? (
                  <PlanOption p={o.p} />
                ) : (
                  <>
                    {o.kind === "sight" && o.s.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={o.s.image} alt="" className="city-opt-img" loading="lazy" />
                    ) : (
                      <span className="city-opt-dot" style={{ "--k": POI_COLOR[poiGroup(o.kind === "sight" ? o.s.cls : o.f.poi?.cls)] } as React.CSSProperties} aria-hidden>
                        <MapPin size={14} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold truncate">{o.kind === "sight" ? o.s.name : o.f.name}</span>
                      <span className="block t-micro text-text-3 truncate">{o.kind === "sight" ? o.s.about : [o.f.poi ? poiLabel(o.f.poi.cls, o.f.poi.sub) : "", o.f.context].filter(Boolean).join(" · ")}</span>
                    </span>
                    <Plus size={16} aria-hidden className="shrink-0 text-cyan" />
                  </>
                )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A plan of one's own, as it was understood: what, when, where. */
function PlanOption({ p }: { p: Omit<TripPlan, "id" | "createdAt"> }) {
  const Icon = KIND_ICON[p.kind];
  return (
    <>
      <span className="city-opt-dot" data-kind={p.kind} aria-hidden><Icon size={15} /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold truncate">{p.title}</span>
        <span className="block t-micro text-text-3 truncate">{[kindLabel(p.kind), `${dayName(p.day)}${p.time ? ` ${p.time}` : ""}`, p.place].filter(Boolean).join(" · ")}</span>
      </span>
      <span className="city-opt-tag">Your plan</span>
    </>
  );
}

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
  const input = useRef<HTMLInputElement>(null);
  const [onDay, setOnDay] = useState<string | null>(null);
  const [picking, setPicking] = useState<Picking | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const near = (p: TripPlan) => p.lat != null && p.lng != null && haversineKm(p.lat, p.lng, stop.lat, stop.lng) <= STOP_RADIUS_KM;
  const mine = plansIn(trip, stop);
  const events = dayEvents.filter((x) => days.includes(x.day));
  const count = (b: string) => mine.filter((p) => BUCKET[p.kind] === b).length;
  const stay = mine.find((p) => p.kind === "stay");
  const onDays = (trip.plans ?? []).filter((p) => isScheduled(p) && days.includes(p.day) && (p.lat == null || near(p)));
  const perDay = (d: string) => [...onDays.filter((p) => p.day === d).sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "")).map((p) => p.kind as string), ...events.filter((x) => x.day === d).map(() => "event")];
  const scrollTo = (sel: string) => document.querySelector<HTMLElement>(`.trip-panel ${sel}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  const save = (p: Picking, w: WhenValue, el: HTMLElement | null) => {
    const from = el?.getBoundingClientRect();
    const when = dayName(w.day || stop.from);
    const said = w.day ? `${p.draft.kind === "stay" && w.endDay ? `${when} → ${dayName(w.endDay)}` : when}${w.time ? `, ${w.time}` : ""}` : "a place to see";
    if (p.existing) {
      const before = p.existing;
      announcePlan(before.id, from);
      userActions.updatePlan(trip.id, before.id, { day: w.day, time: w.time, endTime: w.endTime, endDay: w.endDay, notes: w.notes });
      toast({ title: `${before.title}: ${said}`, emoji: "🗓️", action: { label: "Undo", run: () => userActions.updatePlan(trip.id, before.id, before) } });
    } else {
      const id = newId();
      announcePlan(id, from);
      userActions.addPlan(trip.id, { id, kind: p.draft.kind, title: p.draft.title.slice(0, 80), ...w, lat: p.draft.lat, lng: p.draft.lng, ...(p.draft.poi ? { poi: p.draft.poi } : {}), ...(p.place ? { place: p.place } : {}), createdAt: new Date().toISOString() });
      toast({ title: `Added to ${placeName(stop)}`, body: `${p.draft.title}, ${said}`, emoji: "📍", action: { label: "Undo", run: () => userActions.removePlan(trip.id, id) } });
    }
    try {
      navigator.vibrate?.(8);
    } catch {
      // no vibration here
    }
    setPicking(null);
    setOnDay(null);
  };
  const addOn = (d: string) => {
    setOnDay(d);
    input.current?.focus();
    input.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

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

      <CityAdd trip={trip} stop={stop} sights={sights ?? []} day={onDay} onDay={setOnDay} input={input} events={dayEvents} picking={picking} onPick={setPicking} onSave={save} />

      <Sights trip={trip} stop={stop} sights={sights} onShowAt={onShowAt} onPick={setPicking} day={onDay} />

      <h3 className="city-h mt-5"><MapPin size={14} aria-hidden /> Your plan in {placeName(stop)}</h3>
      <TripAgenda trip={trip} stops={stops} events={dayEvents} only={days} near={stop} compose={false} onAddOnDay={addOn} onOpenEvent={onOpen} onPickStop={onPickStop} onShowPlace={onShowPlace} />

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
