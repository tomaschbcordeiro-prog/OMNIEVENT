"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, Loader2, MapPin, Pencil, Plus, Search, X } from "lucide-react";
import { CITIES } from "@/lib/destinations";
import { flagOf, legsKm, placeName, stopColor, type Place } from "@/lib/trip";
import type { Town } from "@/lib/town";

/*
 * Editing a trip's route by hand: the list of stops (drag to reorder, tap a name to rename it,
 * "+" between two stops to add one there) and the pieces laid on the globe (a "+" in the middle
 * of each leg, and the card for a place tapped on the map).
 */

export type RouteStop = Place & { key: string; looking?: boolean };

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const km = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString("en-GB"));

/** The town or city at a point (a pin dropped near Liverpool is in Liverpool). */
export async function lookupTown(lat: number, lng: number): Promise<Town> {
  try {
    const r = await fetch(`/api/geocode/town?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`);
    if (r.ok) return ((await r.json()) as { town: Town }).town;
  } catch {
    // offline: a pinned place it is
  }
  return { name: "Pinned place", lat, lng };
}

/** A town as a stop's place. */
export const placeOfTown = (t: Town, label?: string): Place => ({ name: label || t.name, country: t.country, countryCode: t.countryCode, cityId: t.cityId, lat: t.lat, lng: t.lng });

/** Any city on Earth: the site's own cities at once, the rest from the place search. */
export function PlaceSearch({ onPick, id = "trip-place", placeholder = "Add a city: Amsterdam, Kyoto, Marrakech…", autoFocus, onCancel, compact }: { onPick: (p: Place) => void; id?: string; placeholder?: string; autoFocus?: boolean; onCancel?: () => void; compact?: boolean }) {
  const [q, setQ] = useState("");
  const [far, setFar] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  const near = useMemo(() => {
    const t = plain(q.trim());
    if (t.length < 1) return [];
    return CITIES.filter((c) => plain(c.name).startsWith(t) || c.aliases?.some((a) => plain(a).startsWith(t)))
      .slice(0, 5)
      .map((c): Place => ({ name: c.name, country: c.country, countryCode: c.countryCode, lat: c.lat, lng: c.lng, cityId: c.id }));
  }, [q]);
  useEffect(() => {
    const t = q.trim();
    setFar([]);
    if (t.length < 3) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      setBusy(true);
      fetch(`/api/geocode?q=${encodeURIComponent(t)}&limit=8&lang=en`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((j: { results: { name: string; context?: string; kind: string; lat: number; lng: number; countryCode?: string }[] }) =>
          setFar(
            j.results
              .filter((r) => ["city", "town", "village", "hamlet", "suburb", "locality", "municipality", "place"].includes(r.kind))
              .map((r): Place => ({ name: r.name, country: r.context?.split(",").pop()?.trim() || undefined, countryCode: r.countryCode, lat: r.lat, lng: r.lng })),
          ),
        )
        .catch(() => {})
        .finally(() => setBusy(false));
    }, 300);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);
  const list = [...near, ...far.filter((f) => !near.some((n) => Math.abs(n.lat - f.lat) < 0.2 && Math.abs(n.lng - f.lng) < 0.2))].slice(0, compact ? 5 : 7);
  const pick = (p: Place) => {
    onPick(p);
    setQ("");
    setHi(0);
    if (!compact) input.current?.focus();
  };
  return (
    <div className="relative">
      <label className="sr-only" htmlFor={id}>{placeholder}</label>
      <div className={`planner-search ${compact ? "is-compact" : ""}`}>
        <Search size={compact ? 15 : 17} aria-hidden className="text-text-3 shrink-0" />
        <input
          ref={input}
          id={id}
          className="flex-1 bg-transparent outline-none min-w-0"
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={list.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={list[hi] ? `${id}-${hi}` : undefined}
          value={q}
          onChange={(e) => (setQ(e.target.value), setHi(0))}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => Math.min(list.length - 1, h + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(0, h - 1));
            } else if (e.key === "Enter" && list[hi]) {
              e.preventDefault();
              pick(list[hi]);
            } else if (e.key === "Escape") {
              if (q) setQ("");
              else onCancel?.();
            }
          }}
        />
        {busy && <Loader2 size={15} className="animate-spin text-text-3 shrink-0" aria-hidden />}
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-icon btn-sm -mr-1.5 shrink-0" aria-label="Cancel" onClick={onCancel}>
            <X size={15} aria-hidden />
          </button>
        )}
      </div>
      {list.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="planner-results">
          {list.map((p, i) => (
            <li key={`${p.name}-${p.lat}`} id={`${id}-${i}`} role="option" aria-selected={i === hi}>
              <button type="button" className="planner-result" data-hi={i === hi || undefined} onMouseEnter={() => setHi(i)} onClick={() => pick(p)}>
                <span className="text-lg" aria-hidden>{flagOf(p.countryCode) || <MapPin size={16} />}</span>
                <span className="min-w-0">
                  <span className="block font-semibold truncate">{p.name}</span>
                  {p.country && <span className="block t-micro text-text-3 truncate">{p.country}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A stop's name: tap to call it something of your own ("Visit João"); empty goes back to the place. */
function StopName({ s, onRename }: { s: RouteStop; onRename: (name: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(s.name);
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    setEdit(false);
    if (v.trim() !== s.name) onRename(v);
  };
  if (edit)
    return (
      <input
        className="route-name-input"
        value={v}
        maxLength={40}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") {
            done.current = true;
            setEdit(false);
          }
        }}
        aria-label={`Name for this stop. The place is ${placeName(s)}; leave it empty to use that.`}
      />
    );
  return (
    <button
      type="button"
      className="route-name"
      disabled={s.looking}
      onClick={() => {
        done.current = false;
        setV(s.name);
        setEdit(true);
      }}
      aria-label={`${s.name}: rename this stop`}
    >
      <span className="truncate">{s.looking ? "Finding the place…" : s.name}</span>
      {s.looking ? <Loader2 size={13} className="animate-spin shrink-0 text-text-3" aria-hidden /> : <Pencil size={12} className="route-name-pen shrink-0" aria-hidden />}
    </button>
  );
}

/**
 * The route, in order. Drag a stop by its handle (or focus the handle and use the arrow keys)
 * to move it; tap its name to rename it; "+" between two stops adds one there, typed or found.
 */
export function RouteList({
  stops,
  onMove,
  onRemove,
  onRename,
  onInsert,
  inserting,
  setInserting,
  onHover,
  onPick,
}: {
  stops: RouteStop[];
  onMove: (from: number, to: number) => void;
  onRemove: (i: number) => void;
  onRename: (i: number, name: string) => void;
  onInsert: (i: number, p: Place) => void;
  /** The gap a stop is being added in (the index it will have). */
  inserting: number | null;
  setInserting: (i: number | null) => void;
  onHover: (i?: number) => void;
  onPick: (i: number) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const drag = useRef<{ from: number; to: number; y0: number; shift: number; mids: number[]; h: number } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [said, setSaid] = useState("");
  const legs = legsKm(stops);
  const items = () => [...(list.current?.querySelectorAll<HTMLElement>(":scope > li") ?? [])];

  const begin = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0 || stops.length < 2) return;
    e.preventDefault();
    const el = items()[i];
    const before = el.getBoundingClientRect().top;
    // The legs fold away while a stop is moved, so every stop is the same height.
    list.current!.dataset.reordering = "";
    const rects = items().map((x) => x.getBoundingClientRect());
    drag.current = { from: i, to: i, y0: e.clientY, shift: before - rects[i].top, mids: rects.map((r) => r.top + r.height / 2), h: rects[1] ? rects[1].top - rects[0].top : rects[0].height };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    el.style.transform = `translateY(${drag.current.shift}px)`;
    setDragging(i);
  };
  const follow = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y0 + d.shift;
    const centre = d.mids[d.from] + dy;
    let to = d.from;
    d.mids.forEach((m, j) => {
      if (j < d.from && centre < m) to = Math.min(to, j);
      if (j > d.from && centre > m) to = Math.max(to, j);
    });
    d.to = to;
    items().forEach((el, j) => {
      if (j === d.from) el.style.transform = `translateY(${dy}px)`;
      else if (d.from < to && j > d.from && j <= to) el.style.transform = `translateY(${-d.h}px)`;
      else if (to < d.from && j >= to && j < d.from) el.style.transform = `translateY(${d.h}px)`;
      else el.style.transform = "";
    });
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(null);
    for (const el of items()) {
      el.style.transition = "none";
      el.style.transform = "";
      requestAnimationFrame(() => (el.style.transition = ""));
    }
    delete list.current!.dataset.reordering;
    if (d.to !== d.from) {
      onMove(d.from, d.to);
      setSaid(`${stops[d.from].name} is now stop ${d.to + 1} of ${stops.length}.`);
    }
  };

  return (
    <>
      <ol ref={list} className="route-list" data-dragging={dragging !== null || undefined}>
        {stops.map((s, i) => (
          <li key={s.key} className="route-item" style={{ "--ink": stopColor(i) } as React.CSSProperties} data-lifted={dragging === i || undefined} onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(undefined)}>
            <div className="route-stop">
              <button
                type="button"
                className="route-grip"
                aria-label={`Move ${s.name}: drag, or use the up and down arrow keys`}
                disabled={stops.length < 2}
                onPointerDown={(e) => begin(e, i)}
                onPointerMove={follow}
                onPointerUp={end}
                onPointerCancel={end}
                onKeyDown={(e) => {
                  const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : -1;
                  if (to < 0 || to >= stops.length) return;
                  e.preventDefault();
                  onMove(i, to);
                  setSaid(`${s.name} is now stop ${to + 1} of ${stops.length}.`);
                }}
              >
                <GripVertical size={16} aria-hidden />
              </button>
              <button type="button" className="planner-stop-n press" aria-label={`Show ${s.name} on the globe`} onClick={() => onPick(i)}>{i + 1}</button>
              <span className="min-w-0 flex-1">
                <StopName s={s} onRename={(name) => onRename(i, name)} />
                <span className="block t-micro text-text-3 truncate">
                  {s.place && <><MapPin size={11} className="inline -mt-0.5" aria-hidden /> {s.place} · </>}
                  {[flagOf(s.countryCode), s.country].filter(Boolean).join(" ") || (s.looking ? "" : `${s.lat.toFixed(2)}, ${s.lng.toFixed(2)}`)}
                </span>
              </span>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${s.name}`} onClick={() => onRemove(i)}><X size={15} aria-hidden /></button>
            </div>
            {i < stops.length - 1 && (
              <div className="route-leg">
                <span className="route-leg-line" aria-hidden />
                {inserting === i + 1 ? (
                  <div className="flex-1 min-w-0 py-1">
                    <PlaceSearch id={`leg-${i}`} compact autoFocus placeholder={`Between ${s.name} and ${stops[i + 1].name}…`} onPick={(p) => onInsert(i + 1, p)} onCancel={() => setInserting(null)} />
                  </div>
                ) : (
                  <>
                    <span className="route-leg-km tnum">{km(legs[i])} km</span>
                    <button type="button" className="route-leg-add press" onClick={() => setInserting(i + 1)} aria-label={`Add a stop between ${s.name} and ${stops[i + 1].name}`}>
                      <Plus size={13} aria-hidden /> Add a stop
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      <p className="sr-only" role="status">{said}</p>
    </>
  );
}

/** Stops a map's own gestures (pan, zoom, keys) from starting inside something laid on it. */
const keep = {
  onMouseDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onTouchStart: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onWheel: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
};

/**
 * The "+" in the middle of a leg on the globe: tap it to type a place to stop at on the way,
 * or drag it onto the map to stop there.
 */
export function LegPlus({ from, to, open, below, onOpen, onClose, onPick }: { from: string; to: string; open: boolean; below?: boolean; onOpen: () => void; onClose: () => void; onPick: (p: Place) => void }) {
  return (
    <div className="leg-plus-wrap" data-open={open || undefined}>
      <button
        type="button"
        className="leg-plus"
        title="Add a stop here: tap to type a place, or drag onto the map"
        aria-label={`Add a stop between ${from} and ${to}: tap to type a place, or drag onto the map`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (open) onClose();
          else onOpen();
        }}
      >
        <Plus size={14} strokeWidth={3} aria-hidden />
      </button>
      {open && (
        <div className="leg-pop" data-below={below || undefined} role="dialog" aria-label={`Add a stop between ${from} and ${to}`} {...keep}>
          <p className="t-micro font-semibold text-text-2 mb-1.5">Between {from} and {to}</p>
          <PlaceSearch id="leg-search" compact autoFocus placeholder="Type a place…" onPick={onPick} onCancel={onClose} />
          <p className="t-micro text-text-3 mt-1.5">Or drag the + to anywhere on the map.</p>
        </div>
      )}
    </div>
  );
}

/** A place tapped on the map: what it is, and where it would go on the route. */
export function MapAddCard({ town, label, where, onAdd, onClose }: { town?: Town; label?: string; where: string; onAdd: () => void; onClose: () => void }) {
  return (
    <div className="map-add" {...keep}>
      <div className="map-add-card" role="dialog" aria-label="Add this place to your route">
        <div className="flex items-start gap-2">
          <span className="text-xl leading-none mt-0.5" aria-hidden>{town ? flagOf(town.countryCode) || "📍" : "📍"}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-tight truncate">{town ? label || town.name : "Finding the place…"}</p>
            <p className="t-micro text-text-3 truncate">{town ? [label && label !== town.name ? town.name : "", town.country].filter(Boolean).join(", ") || " " : " "}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm -mr-1.5 -mt-1" aria-label="Close" onClick={onClose}><X size={14} aria-hidden /></button>
        </div>
        <button type="button" className="btn btn-primary btn-sm w-full mt-2 press" disabled={!town} onClick={onAdd}>
          {town ? <Plus size={14} aria-hidden /> : <Loader2 size={14} className="animate-spin" aria-hidden />} Add to route
        </button>
        {where && <p className="t-micro text-text-3 mt-1 text-center">{where}</p>}
      </div>
      <span className="map-add-dot" aria-hidden />
    </div>
  );
}
