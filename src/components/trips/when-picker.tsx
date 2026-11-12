"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, Clock, MapPin, Minus, NotebookPen, Plus, X } from "lucide-react";
import type { Trip } from "@/lib/user/store";
import { addDays } from "@/lib/trip";
import { isScheduled, type PlanKind } from "@/lib/trip-plans";
import { POI_COLOR, poiGroup } from "@/lib/pois";
import { formatEventTime } from "@/lib/format";
import type { TripEvent } from "@/lib/trip-snap";
import { KIND_ICON } from "./plan-icons";

/*
 * When a place goes in a trip, in a few taps: the day (each with how full it is), a time from
 * the ones that suit it (breakfast for a café, dinner for a restaurant, the evening for a bar),
 * how long, a note; with the day as it would be, and a word if it clashes with something.
 */

export interface PlaceDraft {
  title: string;
  kind: PlanKind;
  lat?: number;
  lng?: number;
  /** The map's kind of place ("cafe", "museum", "attraction/castle"). */
  poi?: string;
  /** A line about it ("Café · Rossio"). */
  about?: string;
  image?: string;
}

export interface WhenValue {
  day: string;
  time?: string;
  endTime?: string;
  endDay?: string;
  notes?: string;
}

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const dayName = (d: string) => fmt(d, { weekday: "short", day: "numeric", month: "short" });
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const LAST = 23 * 60 + 59;

/** The times that suit a kind of place. */
export function timesFor(kind: PlanKind, poi?: string): { label: string; time: string }[] {
  const [cls, sub] = (poi ?? "").split("/");
  const c = `${cls} ${sub ?? ""}`;
  if (/\b(cafe|bakery|pastry|ice_cream|confectionery|coffee)/.test(c)) return [{ label: "Breakfast", time: "09:00" }, { label: "Coffee", time: "11:00" }, { label: "Afternoon", time: "16:30" }];
  if (/\bnightclub/.test(c)) return [{ label: "Night", time: "23:30" }];
  if (/\b(bar|pub|beer|biergarten|wine)/.test(c)) return [{ label: "Sunset", time: "18:30" }, { label: "Evening", time: "21:00" }, { label: "Late", time: "23:00" }];
  if (/\b(theatre|cinema|music|arts_centre|concert)/.test(c)) return [{ label: "Afternoon", time: "16:00" }, { label: "Evening", time: "19:30" }, { label: "Night", time: "21:30" }];
  switch (kind) {
    case "meal":
      return [{ label: "Breakfast", time: "09:00" }, { label: "Lunch", time: "13:00" }, { label: "Dinner", time: "20:30" }];
    case "stay":
      return [{ label: "Check-in", time: "15:00" }];
    case "meeting":
      return [{ label: "Morning", time: "10:00" }, { label: "Lunch", time: "13:00" }, { label: "Afternoon", time: "15:00" }];
    case "visit":
      return [{ label: "Morning", time: "10:00" }, { label: "Midday", time: "12:30" }, { label: "Afternoon", time: "15:00" }];
    default:
      return [{ label: "Morning", time: "10:00" }, { label: "Afternoon", time: "15:00" }, { label: "Evening", time: "19:00" }];
  }
}

const LENGTHS = [30, 60, 90, 120, 180];
const lengthLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m / 60} h`);

interface DayItem {
  key: string;
  title: string;
  time?: string;
  endTime?: string;
  kind: PlanKind | "event";
}

export function WhenPicker({
  trip,
  draft,
  days,
  initial,
  events,
  verb = "Add",
  skip,
  focusSave,
  head = true,
  onCancel,
  onSave,
  onRemove,
}: {
  trip: Trip;
  draft: PlaceDraft;
  /** The days it can go on (the city's, or the trip's). */
  days: string[];
  initial?: Partial<WhenValue>;
  /** The trip's events, to show each day as it is. */
  events?: { e: TripEvent; day: string }[];
  /** "Add", or "Save" for one already on the trip. */
  verb?: string;
  /** A plan to leave out of the day as it is (the one being changed). */
  skip?: string;
  /** Put the keyboard on the button that adds it (it was chosen with the keyboard). */
  focusSave?: boolean;
  /** Its name and picture on top (not where the card around it says them already). */
  head?: boolean;
  onCancel: () => void;
  onSave: (w: WhenValue, el: HTMLElement | null) => void;
  /** Take it off the trip (one that's on it). */
  onRemove?: () => void;
}) {
  const uid = useId();
  const box = useRef<HTMLDivElement>(null);
  const saveBtn = useRef<HTMLButtonElement>(null);
  const stay = draft.kind === "stay";
  const presets = useMemo(() => timesFor(draft.kind, draft.poi), [draft.kind, draft.poi]);
  const [day, setDay] = useState(initial?.day && days.includes(initial.day) ? initial.day : stay ? (days[0] ?? "") : "");
  const [time, setTime] = useState(initial?.time ?? "");
  const [own, setOwn] = useState(!!initial?.time && !presets.some((p) => p.time === initial.time));
  const [length, setLength] = useState<number | null>(initial?.time && initial.endTime ? toMin(initial.endTime) - toMin(initial.time) : null);
  const [nights, setNights] = useState(() => {
    if (initial?.day && initial.endDay) return Math.max(1, Math.round((Date.parse(initial.endDay) - Date.parse(initial.day)) / 86400e3));
    return Math.max(1, days.length - 1);
  });
  const [note, setNote] = useState(initial?.notes ?? "");
  const [noting, setNoting] = useState(!!initial?.notes);

  useEffect(() => {
    if (focusSave) saveBtn.current?.focus({ preventScroll: true });
    box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusSave]);

  // What's on each day already.
  const itemsOn = useMemo(() => {
    const by = new Map<string, DayItem[]>();
    const put = (d: string, x: DayItem) => by.set(d, [...(by.get(d) ?? []), x]);
    for (const p of trip.plans ?? []) if (isScheduled(p) && p.id !== skip && p.kind !== "stay") put(p.day, { key: p.id, title: p.title, time: p.time, endTime: p.endTime, kind: p.kind });
    for (const { e, day: d } of events ?? []) put(d, { key: `e${e.id}`, title: e.title, time: e.hoursUnknown || e.eventType === "daily_attraction" ? undefined : formatEventTime(e.start, e.timeZone), kind: "event" });
    for (const [d, list] of by) by.set(d, list.sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99")));
    return by;
  }, [trip.plans, events, skip]);

  const endTime = time && length ? toTime(Math.min(LAST, toMin(time) + length)) : undefined;
  const others = day ? (itemsOn.get(day) ?? []) : [];
  const clash = time
    ? others.find((x) => {
        if (!x.time) return false;
        const a0 = toMin(time);
        const a1 = endTime ? toMin(endTime) : a0 + 60;
        const b0 = toMin(x.time);
        const b1 = x.endTime && toMin(x.endTime) > b0 ? toMin(x.endTime) : b0 + 60;
        return a0 < b1 && b0 < a1;
      })
    : undefined;

  const value = (): WhenValue => {
    if (!day) return { day: "", ...(note.trim() ? { notes: note.trim().slice(0, 200) } : {}) };
    return {
      day,
      ...(time ? { time } : {}),
      ...(endTime && !stay ? { endTime } : {}),
      ...(stay ? { endDay: addDays(day, nights) } : {}),
      ...(note.trim() ? { notes: note.trim().slice(0, 200) } : {}),
    };
  };
  const label = !day ? (verb === "Add" ? "Add to places to see" : `${verb}, no day yet`) : stay ? `${verb} · ${nights} ${nights === 1 ? "night" : "nights"} from ${fmt(day, { weekday: "short", day: "numeric" })}` : `${verb} · ${dayName(day)}${time ? `, ${time}` : ""}`;
  const Icon = KIND_ICON[draft.kind];
  const color = draft.poi ? POI_COLOR[poiGroup(draft.poi.split("/")[0], draft.poi.split("/")[1])] : undefined;
  const preview: DayItem[] = day ? [...others, { key: "new", title: draft.title, time: time || undefined, endTime, kind: draft.kind }].sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99")) : [];

  return (
    <div
      ref={box}
      className="wp"
      role="group"
      aria-label={`When: ${draft.title}`}
      style={color ? ({ "--k": color } as React.CSSProperties) : undefined}
      data-kind={color ? undefined : draft.kind}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      {head && (
        <div className="wp-head">
          {draft.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.image} alt="" className="wp-pic" />
          ) : (
            <span className="wp-pic wp-pic-icon" aria-hidden><Icon size={18} /></span>
          )}
          <div className="min-w-0 flex-1">
            <p className="wp-title">{draft.title}</p>
            {draft.about && <p className="wp-about"><MapPin size={11} aria-hidden /> {draft.about}</p>}
          </div>
          <button type="button" className="ag-icon-btn -mr-1 -mt-1" aria-label="Cancel" onClick={onCancel}><X size={15} aria-hidden /></button>
        </div>
      )}

      <div className="wp-sec">
        <p className="wp-label" id={`${uid}-day`}><CalendarDays size={13} aria-hidden /> {stay ? "Check in" : "Day"}</p>
        <div className="wp-days" role="radiogroup" aria-labelledby={`${uid}-day`}>
          <button type="button" role="radio" aria-checked={day === ""} className="wp-day wp-day-none" onClick={() => setDay("")}>
            <span className="wp-day-n">No day</span>
            <span className="wp-day-wd">yet</span>
          </button>
          {days.map((d) => {
            const n = itemsOn.get(d)?.length ?? 0;
            return (
              <button key={d} type="button" role="radio" aria-checked={day === d} className="wp-day" onClick={() => setDay(d)} aria-label={`${dayName(d)}, ${n ? `${n} planned` : "free"}`}>
                <span className="wp-day-wd">{fmt(d, { weekday: "short" })}</span>
                <span className="wp-day-n tnum">{fmt(d, { day: "numeric" })}</span>
                <span className="wp-day-dots" aria-hidden>{n ? Array.from({ length: Math.min(n, 4) }, (_, i) => <i key={i} />) : <em>free</em>}</span>
              </button>
            );
          })}
        </div>
      </div>

      {day && stay && (
        <div className="wp-sec wp-row">
          <p className="wp-label" id={`${uid}-nights`}>Nights</p>
          <div className="wp-stepper" role="group" aria-labelledby={`${uid}-nights`}>
            <button type="button" aria-label="One night less" disabled={nights <= 1} onClick={() => setNights((n) => Math.max(1, n - 1))}><Minus size={14} aria-hidden /></button>
            <span className="tnum" aria-live="polite">{nights}</span>
            <button type="button" aria-label="One night more" disabled={nights >= 30} onClick={() => setNights((n) => Math.min(30, n + 1))}><Plus size={14} aria-hidden /></button>
          </div>
          <span className="t-micro text-text-3">out {dayName(addDays(day, nights))}</span>
        </div>
      )}

      {day && (
        <div className="wp-sec wp-in">
          <p className="wp-label" id={`${uid}-time`}><Clock size={13} aria-hidden /> Time</p>
          <div className="wp-chips" role="radiogroup" aria-labelledby={`${uid}-time`}>
            <button type="button" role="radio" aria-checked={!time} className="wp-chip" onClick={() => (setTime(""), setOwn(false), setLength(null))}>Any time</button>
            {presets.map((p) => (
              <button key={p.label} type="button" role="radio" aria-checked={time === p.time && !own} className="wp-chip" onClick={() => (setTime(p.time), setOwn(false))}>
                {p.label} <span className="tnum wp-chip-t">{p.time}</span>
              </button>
            ))}
            <button type="button" role="radio" aria-checked={own} className="wp-chip" onClick={() => (setOwn(true), setTime((t) => t || presets[0]?.time || "12:00"))}>Other…</button>
          </div>
          {own && (
            <label className="wp-own">
              <span className="sr-only">Time</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} autoFocus onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onSave(value(), box.current))} />
            </label>
          )}
          {time && !stay && (
            <div className="wp-chips mt-2" role="radiogroup" aria-label="How long">
              <span className="wp-for">For</span>
              {LENGTHS.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={length === m} className="wp-chip wp-chip-sm" onClick={() => setLength(length === m ? null : m)}>
                  {lengthLabel(m)}
                </button>
              ))}
              {length && !LENGTHS.includes(length) && (
                <button type="button" role="radio" aria-checked className="wp-chip wp-chip-sm" onClick={() => setLength(null)}>until {endTime}</button>
              )}
            </div>
          )}
        </div>
      )}

      {day && !stay && (
        <div className="wp-sec">
          <ol className="wp-preview" aria-label={`${dayName(day)} as it would be`}>
            {preview.slice(0, 7).map((x) => {
              const I = x.kind === "event" ? null : KIND_ICON[x.kind];
              return (
                <li key={x.key} className={x.key === "new" ? "is-new" : undefined} data-clash={x.key === clash?.key || undefined}>
                  <span className="tnum wp-pt">{x.time ? `${x.time}${x.endTime ? `–${x.endTime}` : ""}` : "Any time"}</span>
                  <span className="wp-pi" aria-hidden>{I ? <I size={12} /> : <span className="wp-pi-ev" />}</span>
                  <span className="truncate">{x.title}</span>
                </li>
              );
            })}
          </ol>
          {clash && (
            <p className="wp-clash" role="status">
              <AlertTriangle size={13} aria-hidden /> Same time as {clash.title}
            </p>
          )}
        </div>
      )}

      <div className="wp-sec">
        {noting ? (
          <label className="ag-field">
            <span>Note</span>
            <textarea value={note} maxLength={200} rows={2} autoFocus onChange={(e) => setNote(e.target.value)} placeholder={draft.kind === "meal" ? "Book a table; try the fish" : "Tickets online; go early"} />
          </label>
        ) : (
          <button type="button" className="wp-add-note" onClick={() => setNoting(true)}>
            <NotebookPen size={13} aria-hidden /> Add a note
          </button>
        )}
      </div>

      <div className="wp-actions">
        {onRemove && <button type="button" className="btn btn-ghost btn-sm wp-remove" onClick={onRemove}>Remove</button>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button ref={saveBtn} type="button" className="btn btn-primary btn-sm press wp-save" onClick={() => onSave(value(), box.current)}>
          {label}
        </button>
      </div>
    </div>
  );
}
