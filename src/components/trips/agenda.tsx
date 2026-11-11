"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { BedDouble, Briefcase, Bus, CarFront, ChevronDown, CornerDownLeft, NotebookPen, Plane, Plus, Sparkles, TrainFront, Trash2, UtensilsCrossed, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { userActions, type Trip } from "@/lib/user/store";
import { addDays, daysOf, stopColor, type TripStop } from "@/lib/trip";
import { durationOf, isTravel, kindLabel, nightsOf, parsePlan, PLAN_KINDS, planSortKey, type PlanKind, type TripPlan } from "@/lib/trip-plans";
import { formatEventTime } from "@/lib/format";
import type { TripEvent } from "@/lib/trip-snap";
import { Poster } from "../ui";
import { toast } from "../toast";

/*
 * A trip as an agenda: day by day, your own plans (the flight, the hotel, a meeting) with the
 * events you've added, in time order. One line adds a plan ("Flight TP1350 Lisbon to London
 * 2 Dec 9:40"), understood as it's typed; travel days and cities without a bed ask how you get
 * there and where you stay. New things glide from the line into their place.
 */

export const KIND_ICON: Record<PlanKind, LucideIcon> = {
  flight: Plane,
  train: TrainFront,
  bus: Bus,
  car: CarFront,
  stay: BedDouble,
  meeting: Briefcase,
  meal: UtensilsCrossed,
  activity: Sparkles,
  note: NotebookPen,
};

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const dayName = (d: string) => fmt(d, { weekday: "short", day: "numeric", month: "short" });
const today = () => new Date().toISOString().slice(0, 10);
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 12) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`);
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

type Row =
  | { key: string; sort: string; type: "plan"; plan: TripPlan }
  | { key: string; sort: string; type: "stay"; plan: TripPlan; night: number; nights: number; out?: boolean }
  | { key: string; sort: string; type: "event"; e: TripEvent; time?: string }
  | { key: string; sort: string; type: "travel"; from?: TripStop; to?: TripStop }
  | { key: string; sort: string; type: "bed"; stop: TripStop };

interface Day {
  day: string;
  stops: { stop: TripStop; index: number }[];
  rows: Row[];
}

/** The trip's days, each with its cities and everything on it, in order. */
function buildDays(trip: Trip, stops: TripStop[], events: { e: TripEvent; day: string }[], only?: string[]): Day[] {
  const plans = trip.plans ?? [];
  const range = stops.length ? daysOf(stops[0].from, stops[stops.length - 1].to) : trip.start && trip.end ? daysOf(trip.start, trip.end) : [];
  const all = [...new Set([...range, ...plans.map((p) => p.day), ...events.map((x) => x.day)])].sort();
  const want = only ? all.filter((d) => only.includes(d)) : all;
  return want.map((day) => {
    const here = stops.map((stop, index) => ({ stop, index })).filter(({ stop }) => day >= stop.from && day <= stop.to);
    const rows: Row[] = [];
    for (const p of plans) {
      if (p.kind === "stay") {
        const n = nightsOf(p);
        const end = p.endDay ?? p.day;
        if (day >= p.day && day < end) rows.push({ key: `stay:${p.id}:${day}`, sort: "00", type: "stay", plan: p, night: Math.round((Date.parse(day) - Date.parse(p.day)) / 86_400_000) + 1, nights: n });
        else if (day === end && end > p.day) rows.push({ key: `out:${p.id}`, sort: `1${p.endTime ?? "10:59"}`, type: "stay", plan: p, night: n, nights: n, out: true });
        else if (day === p.day && n === 0) rows.push({ key: `plan:${p.id}`, sort: planSortKey(p), type: "plan", plan: p });
        continue;
      }
      if (p.day === day) rows.push({ key: `plan:${p.id}`, sort: planSortKey(p), type: "plan", plan: p });
    }
    for (const { e, day: d } of events) if (d === day) rows.push({ key: `event:${e.id}`, sort: e.hoursUnknown || e.eventType === "daily_attraction" ? "2" : `1${formatEventTime(e.start, e.timeZone)}`, type: "event", e, time: e.hoursUnknown || e.eventType === "daily_attraction" ? undefined : formatEventTime(e.start, e.timeZone) });
    // Getting there: on the first day, and on each day the trip moves on, unless it's planned.
    const moving = plans.some((p) => isTravel(p.kind) && p.day === day);
    stops.forEach((s, i) => {
      if (s.from !== day || moving) return;
      if (i === 0 || stops[i - 1].to === day) rows.push({ key: `travel:${s.id}`, sort: "01", type: "travel", from: stops[i - 1], to: s });
    });
    // And home again, on the last day.
    const last = stops[stops.length - 1];
    if (last && last.to === day && !moving && last.to > last.from) rows.push({ key: `home:${last.id}`, sort: "4", type: "travel", from: last });
    // A bed: on a city's first day, when no stay covers its first night.
    for (const { stop } of here) {
      if (stop.from !== day || stop.to <= stop.from) continue;
      const covered = plans.some((p) => p.kind === "stay" && p.day <= stop.from && (p.endDay ?? p.day) > stop.from);
      if (!covered) rows.push({ key: `bed:${stop.id}`, sort: "3", type: "bed", stop });
    }
    rows.sort((a, b) => a.sort.localeCompare(b.sort));
    return { day, stops: here, rows };
  });
}

/**
 * Moves that read as one: what was on screen glides to where it now is, what's new slides in
 * (from the line it was typed in, when it was), and what goes folds away first.
 */
function useFlip(box: RefObject<HTMLElement | null>, sig: string) {
  const before = useRef<Map<string, DOMRect> | null>(null);
  const born = useRef<{ id: string; from?: DOMRect } | null>(null);
  const capture = () => {
    const m = new Map<string, DOMRect>();
    box.current?.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => m.set(el.dataset.flip!, el.getBoundingClientRect()));
    before.current = m;
  };
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    if (!was || reduced()) return;
    const fresh = born.current;
    born.current = null;
    box.current?.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const id = el.dataset.flip!;
      const now = el.getBoundingClientRect();
      const old = was.get(id);
      if (old) {
        const dy = old.top - now.top;
        if (Math.abs(dy) > 0.5) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 360, easing: EASE });
        return;
      }
      const mine = fresh && el.dataset.plan === fresh.id;
      if (mine && fresh.from && !el.dataset.flip!.startsWith("stay:")) {
        // From the line it was typed in, to its place in the day.
        el.animate(
          [
            { transform: `translate(${fresh.from.left - now.left}px, ${fresh.from.top - now.top}px)`, opacity: 0.55 },
            { transform: "none", opacity: 1 },
          ],
          { duration: 520, easing: EASE },
        );
      } else el.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 280, delay: mine ? 0 : 80, easing: "ease-out", fill: "backwards" });
      if (mine) {
        el.classList.add("is-new");
        window.setTimeout(() => el.classList.remove("is-new"), 1700);
      }
    });
    if (fresh) box.current?.querySelector<HTMLElement>(`[data-plan="${fresh.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [sig, box]);
  return {
    capture,
    born: (id: string, from?: DOMRect) => (born.current = { id, from }),
    /** Folds a plan's rows away, then lets it go. */
    leave: async (id: string) => {
      if (reduced()) return;
      const els = [...(box.current?.querySelectorAll<HTMLElement>(`[data-plan="${id}"]`) ?? [])];
      await Promise.all(
        els.map(
          (el) =>
            el.animate(
              [
                { opacity: 1, height: `${el.offsetHeight}px`, transform: "none" },
                { opacity: 0, height: "0px", transform: "translateX(12px)", marginTop: "0px", marginBottom: "0px", paddingTop: "0px", paddingBottom: "0px" },
              ],
              { duration: 240, easing: "ease-in", fill: "forwards" },
            ).finished,
        ),
      ).catch(() => {});
    },
  };
}

/** A plan as one row of the agenda (also the preview of what's being typed). */
function PlanRow({ p, onEdit, preview }: { p: Omit<TripPlan, "id" | "createdAt">; onEdit?: () => void; preview?: boolean }) {
  const Icon = KIND_ICON[p.kind];
  const length = durationOf(p);
  const route = isTravel(p.kind) && (p.from || p.to) ? `${p.from ?? "?"} → ${p.to ?? "?"}` : "";
  const meta = [route, p.ref, length, p.place, !preview && p.notes ? p.notes.split("\n")[0] : ""].filter(Boolean).join(" · ");
  const Tag = onEdit ? "button" : "div";
  return (
    <Tag type={onEdit ? "button" : undefined} className="ag-item" data-kind={p.kind} onClick={onEdit} aria-label={onEdit ? `${kindLabel(p.kind)}: ${p.title}${p.time ? ` at ${p.time}` : ""}. Edit` : undefined}>
      <span className={`ag-time tnum ${p.time ? "" : "is-loose"}`}>
        {p.time ?? (p.kind === "stay" ? "" : "Any time")}
        {p.endTime && <span className="ag-time-end">{p.endTime}</span>}
      </span>
      <span className="ag-dot" aria-hidden>
        <Icon size={14} strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="ag-title">{p.title}</span>
        {meta && <span className="ag-meta">{meta}</span>}
        {preview && <span className="ag-meta">{dayName(p.day)}{p.kind === "stay" && p.endDay ? ` → ${dayName(p.endDay)}, ${nightsOf(p)} ${nightsOf(p) === 1 ? "night" : "nights"}` : ""}</span>}
      </span>
    </Tag>
  );
}

/** What's needed to make a plan: from what's typed, from a suggestion, or an existing plan. */
type Draft = Omit<TripPlan, "id" | "createdAt">;

/** Every field of a plan, for when a line isn't enough (or to change one). */
function PlanForm({ draft, days, onChange, onSave, onCancel, onDelete, saveLabel }: { draft: Draft; days: string[]; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void; onDelete?: () => void; saveLabel: string }) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const opts = [...new Set([addDays(days[0] ?? today(), -1), ...days, addDays(days[days.length - 1] ?? today(), 1), draft.day, draft.endDay].filter((x): x is string => !!x))].sort();
  const travel = isTravel(draft.kind);
  const stay = draft.kind === "stay";
  const daySelect = (label: string, value: string, onPick: (v: string) => void) => (
    <label className="ag-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onPick(e.target.value)}>
        {opts.map((d) => (
          <option key={d} value={d}>{dayName(d)}</option>
        ))}
      </select>
    </label>
  );
  return (
    <form
      className="ag-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.title.trim()) onSave();
      }}
    >
      <div className="ag-kinds" role="radiogroup" aria-label="What it is">
        {PLAN_KINDS.map(({ kind, label }) => {
          const Icon = KIND_ICON[kind];
          return (
            <button key={kind} type="button" role="radio" aria-checked={draft.kind === kind} className="ag-kind" data-kind={kind} onClick={() => set({ kind, endDay: kind === "stay" ? draft.endDay ?? addDays(draft.day, 1) : draft.endDay })}>
              <Icon size={14} aria-hidden /> {label}
            </button>
          );
        })}
      </div>
      <label className="ag-field ag-wide">
        <span>{stay ? "Where you're staying" : travel ? "Name" : "What"}</span>
        <input value={draft.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} placeholder={stay ? "Hotel Plaza" : travel ? "Flight to London" : "Meeting with João"} required />
      </label>
      {travel && (
        <>
          <label className="ag-field">
            <span>From</span>
            <input value={draft.from ?? ""} maxLength={60} onChange={(e) => set({ from: e.target.value || undefined })} placeholder="Lisbon" />
          </label>
          <label className="ag-field">
            <span>To</span>
            <input value={draft.to ?? ""} maxLength={60} onChange={(e) => set({ to: e.target.value || undefined })} placeholder="London" />
          </label>
        </>
      )}
      {daySelect(stay ? "Check in" : travel ? "Leaves" : "Day", draft.day, (v) => set({ day: v, endDay: stay && (draft.endDay ?? "") <= v ? addDays(v, 1) : draft.endDay }))}
      <label className="ag-field">
        <span>{stay ? "Check-in time" : travel ? "Departs" : "Starts"}</span>
        <input type="time" value={draft.time ?? ""} onChange={(e) => set({ time: e.target.value || undefined })} />
      </label>
      {stay && daySelect("Check out", draft.endDay ?? addDays(draft.day, 1), (v) => set({ endDay: v > draft.day ? v : addDays(draft.day, 1) }))}
      <label className="ag-field">
        <span>{stay ? "Check-out time" : travel ? "Arrives" : "Ends"}</span>
        <input type="time" value={draft.endTime ?? ""} onChange={(e) => set({ endTime: e.target.value || undefined })} />
      </label>
      {!travel && (
        <label className="ag-field ag-wide">
          <span>Where</span>
          <input value={draft.place ?? ""} maxLength={80} onChange={(e) => set({ place: e.target.value || undefined })} placeholder={stay ? "Address" : "Café Nicola, Rossio"} />
        </label>
      )}
      <label className="ag-field">
        <span>{travel ? "Flight / booking no." : "Booking ref"}</span>
        <input value={draft.ref ?? ""} maxLength={30} onChange={(e) => set({ ref: e.target.value || undefined })} placeholder={travel ? "TP 1350" : "ABC123"} />
      </label>
      <label className="ag-field ag-wide">
        <span>Notes</span>
        <input value={draft.notes ?? ""} maxLength={200} onChange={(e) => set({ notes: e.target.value || undefined })} placeholder="Seat 12A, gate closes 40 min before" />
      </label>
      <div className="ag-form-actions">
        {onDelete && (
          <button type="button" className="btn btn-ghost btn-sm text-bad mr-auto" onClick={onDelete}>
            <Trash2 size={14} aria-hidden /> Delete
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm press" disabled={!draft.title.trim()}>{saveLabel}</button>
      </div>
    </form>
  );
}

/**
 * The trip, day by day. `only` keeps to some days (a city's), `onPickStop` opens a city, and
 * events open on the globe.
 */
export function TripAgenda({ trip, stops, events, only, onOpenEvent, onPickStop }: { trip: Trip; stops: TripStop[]; events: { e: TripEvent; day: string }[]; only?: string[]; onOpenEvent: (id: string) => void; onPickStop: (i: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => buildDays(trip, stops, events, only), [trip, stops, events, only]);
  const tripDays = useMemo(() => (stops.length ? daysOf(stops[0].from, stops[stops.length - 1].to) : days.map((d) => d.day)), [stops, days]);
  const [text, setText] = useState("");
  const [onDay, setOnDay] = useState<string | null>(null);
  const [form, setForm] = useState<Draft | null>(null);
  /** A plan being changed, and the row its form opens in. */
  const [editing, setEditing] = useState<{ id: string; draft: Draft; at: string } | null>(null);
  const sig = days.map((d) => d.rows.map((r) => r.key).join()).join("|");
  const flip = useFlip(box, sig);

  const baseDay = onDay ?? (only?.[0] && tripDays.includes(only[0]) ? only[0] : tripDays.find((d) => d >= today()) ?? tripDays[0] ?? today());
  const parsed = text.trim().length >= 2 ? parsePlan(text, { days: tripDays, defaultDay: baseDay }) : null;

  const add = (d: Draft, from?: DOMRect | null) => {
    const plan: TripPlan = { ...d, title: d.title.trim(), id: newId(), createdAt: new Date().toISOString() };
    flip.capture();
    flip.born(plan.id, from ?? undefined);
    userActions.addPlan(trip.id, plan);
    try {
      navigator.vibrate?.(8);
    } catch {
      // no vibration here
    }
    toast({ title: `${kindLabel(plan.kind)} added`, body: `${plan.title}, ${dayName(plan.day)}${plan.time ? ` ${plan.time}` : ""}`, emoji: "🗓️", action: { label: "Undo", run: () => userActions.removePlan(trip.id, plan.id) } });
  };
  const submitLine = () => {
    if (!parsed) return;
    add(parsed, previewRef.current?.getBoundingClientRect());
    setText("");
    setOnDay(null);
  };
  const remove = async (p: TripPlan) => {
    setEditing(null);
    await flip.leave(p.id);
    flip.capture();
    userActions.removePlan(trip.id, p.id);
    toast({ title: `${kindLabel(p.kind)} deleted`, body: p.title, emoji: "🗑️", action: { label: "Undo", run: () => (flip.capture(), flip.born(p.id), userActions.addPlan(trip.id, p)) } });
  };
  const save = () => {
    if (!editing) return;
    flip.capture();
    userActions.updatePlan(trip.id, editing.id, editing.draft);
    setEditing(null);
  };
  const startOn = (day: string) => {
    setOnDay(day);
    setForm(null);
    line.current?.focus();
  };
  // A suggestion opens the form, filled in.
  const suggest = (d: Draft) => {
    setForm(d);
    setText("");
    window.requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(".ag-compose")?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  useEffect(() => {
    if (form) box.current?.querySelector<HTMLInputElement>(".ag-compose .ag-form input")?.focus();
  }, [form]);

  return (
    <div ref={box} className="ag">
      <div className="ag-compose">
        {form ? (
          <PlanForm draft={form} days={tripDays} onChange={setForm} onCancel={() => setForm(null)} saveLabel="Add to trip" onSave={() => (add(form, box.current?.querySelector(".ag-compose")?.getBoundingClientRect()), setForm(null))} />
        ) : (
          <>
            <div className="ag-line">
              <Plus size={16} aria-hidden className="ag-line-plus" />
              {onDay && (
                <span className="ag-on">
                  {dayName(onDay)}
                  <button type="button" aria-label="Any day" onClick={() => setOnDay(null)}><X size={12} aria-hidden /></button>
                </span>
              )}
              <input
                ref={line}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitLine();
                  } else if (e.key === "Escape") {
                    setText("");
                    setOnDay(null);
                  }
                }}
                placeholder={onDay ? "Flight, hotel, meeting, dinner…" : "Add a flight, hotel, meeting… “Flight TP1350 Lisbon to London 2 Dec 9:40”"}
                aria-label="Add something to your trip: type it as you'd say it"
                aria-describedby={parsed ? "ag-preview" : undefined}
                enterKeyHint="done"
              />
              {parsed && (
                <button type="button" className="ag-line-go press" onClick={submitLine} aria-label="Add it">
                  <CornerDownLeft size={15} aria-hidden />
                </button>
              )}
            </div>
            {parsed ? (
              <div className="ag-preview" id="ag-preview" ref={previewRef} aria-live="polite">
                <PlanRow p={parsed} preview />
                <button type="button" className="ag-more" onClick={() => (setForm(parsed), setText(""))}>
                  Details <ChevronDown size={13} aria-hidden />
                </button>
              </div>
            ) : (
              <div className="ag-chips" aria-label="Or pick what to add">
                {PLAN_KINDS.filter((k) => k.kind !== "note" && k.kind !== "bus").map(({ kind, label }) => {
                  const Icon = KIND_ICON[kind];
                  return (
                    <button key={kind} type="button" className="ag-chip" data-kind={kind} onClick={() => setForm({ kind, title: "", day: baseDay, endDay: kind === "stay" ? addDays(baseDay, 1) : undefined })}>
                      <Icon size={13} aria-hidden /> {label}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {!days.length && <p className="t-small text-text-2 mt-4">Add the route&apos;s dates to see the trip day by day.</p>}
      <ol className="ag-days">
        {days.map(({ day, stops: here, rows }) => (
          <li key={day} className="ag-day" data-today={day === today() || undefined}>
            <div className="ag-day-head">
              <span className="ag-day-date">
                <span className="ag-day-wd">{fmt(day, { weekday: "short" })}</span>
                <span className="ag-day-n tnum">{fmt(day, { day: "numeric" })}</span>
                <span className="ag-day-m">{fmt(day, { month: "short" })}</span>
              </span>
              <span className="ag-day-where">
                {here.map(({ stop, index }, k) => (
                  <span key={stop.id} className="contents">
                    {k > 0 && <span className="text-text-3" aria-hidden>→</span>}
                    <button type="button" className="ag-city" style={{ "--ink": stopColor(index) } as React.CSSProperties} onClick={() => onPickStop(index)}>
                      {stop.name}
                    </button>
                  </span>
                ))}
                {day === today() && <span className="ag-today">Today</span>}
              </span>
              <button type="button" className="ag-day-add" aria-label={`Add something on ${dayName(day)}`} onClick={() => startOn(day)}>
                <Plus size={15} aria-hidden />
              </button>
            </div>
            <ul className="ag-rows">
              {rows.map((r) => (
                <li key={r.key} data-flip={r.key} data-plan={"plan" in r ? r.plan.id : undefined} className={`ag-row ag-${r.type}`}>
                  {(r.type === "plan" || r.type === "stay") && editing?.at === r.key ? (
                    <PlanForm draft={editing.draft} days={tripDays} onChange={(d) => setEditing({ ...editing, draft: d })} onCancel={() => setEditing(null)} onDelete={() => void remove(r.plan)} onSave={save} saveLabel="Save" />
                  ) : null}
                  {r.type === "plan" && editing?.at !== r.key && <PlanRow p={r.plan} onEdit={() => setEditing({ id: r.plan.id, draft: r.plan, at: r.key })} />}
                  {r.type === "stay" &&
                    editing?.at !== r.key && (
                      <button type="button" className="ag-stay-band" data-kind="stay" onClick={() => setEditing({ id: r.plan.id, draft: r.plan, at: r.key })} aria-label={`${r.plan.title}: ${r.out ? "check out" : `night ${r.night} of ${r.nights}`}. Edit`}>
                        <BedDouble size={14} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">
                          <b>{r.out ? "Check out" : r.night === 1 ? "Check in" : "Staying"}</b> · {r.plan.title}
                          {r.plan.place ? `, ${r.plan.place}` : ""}
                        </span>
                        <span className="tnum shrink-0">{r.out ? (r.plan.endTime ?? "") : r.night === 1 && r.plan.time ? r.plan.time : `${r.night}/${r.nights}`}</span>
                      </button>
                    )}
                  {r.type === "event" && (
                    <button type="button" className="ag-item ag-event" onClick={() => onOpenEvent(r.e.id)} aria-label={`${r.e.title}${r.time ? ` at ${r.time}` : ""}. Show it on the globe`}>
                      <span className={`ag-time tnum ${r.time ? "" : "is-loose"}`}>{r.time ?? "Any time"}</span>
                      <span className="ag-dot ag-dot-poster" aria-hidden>
                        <Poster title={r.e.title} imageUrl={r.e.imageUrl} hue={r.e.posterHue} categorySlug={r.e.categorySlug} size="sm" className="h-full w-full" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="ag-title">{r.e.title}</span>
                        <span className="ag-meta">{r.e.venueName}</span>
                      </span>
                    </button>
                  )}
                  {r.type === "travel" && (
                    <div className="ag-suggest">
                      <span className="ag-suggest-q">{r.from && r.to ? <>Getting from {r.from.name} to {r.to.name}?</> : r.to ? <>Getting to {r.to.name}?</> : <>Heading home from {r.from?.name}?</>}</span>
                      <span className="ag-suggest-opts">
                        {(["flight", "train", "bus", "car"] as const).map((k) => {
                          const Icon = KIND_ICON[k];
                          const where = r.to?.name ?? "home";
                          return (
                            <button key={k} type="button" className="ag-chip" data-kind={k} onClick={() => suggest({ kind: k, title: r.to ? `${kindLabel(k)} to ${r.to.name}` : `${kindLabel(k)} home`, day, from: r.from?.name, to: r.to?.name })} aria-label={`Add a ${kindLabel(k).toLowerCase()} ${r.to ? "to" : ""} ${where}`.replace("  ", " ")}>
                              <Icon size={13} aria-hidden /> <span className="max-sm:sr-only">{kindLabel(k)}</span>
                            </button>
                          );
                        })}
                      </span>
                    </div>
                  )}
                  {r.type === "bed" && (
                    <button type="button" className="ag-suggest ag-suggest-bed" onClick={() => suggest({ kind: "stay", title: "", day: r.stop.from, endDay: r.stop.to })}>
                      <BedDouble size={14} aria-hidden /> Where are you staying in {r.stop.name}? <span className="ag-suggest-add">Add</span>
                    </button>
                  )}
                </li>
              ))}
              {!rows.length && (
                <li className="ag-row ag-free" data-flip={`free:${day}`}>
                  <button type="button" onClick={() => startOn(day)}>Free day · add something</button>
                </li>
              )}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
