"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { X, Crosshair, Info, Loader2, ListFilter, Bookmark, Check, Clock } from "lucide-react";
import type { EventCard, SearchFilters } from "@/lib/types";
import { filtersToParams } from "@/lib/search/params";
import { summarizeSearch } from "@/lib/search/summary";
import { RADIUS_PRESETS, formatKm, kmToSlider, sliderToKm, RADIUS_MAX } from "@/lib/map/circle";
import { TIME_PRESETS } from "@/lib/time";
import { userActions } from "@/lib/user/store";
import { EventRow } from "../event-card";
import { ErrorState } from "../ui";

interface TzInfo {
  timeZone: string;
  label: string;
  today: string;
  localNow: string;
}

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Weekend (Fri–Sun) containing or following a local date. */
function weekendOf(ymd: string): [string, string] {
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  if (dow === 0) return [ymd, ymd];
  if (dow === 6) return [ymd, addDays(ymd, 1)];
  return [addDays(ymd, 5 - dow < 0 ? 0 : 5 - dow), addDays(ymd, 7 - dow)];
}

/**
 * "Explore nearby": radius, local date and time controls plus live results for the search
 * circle. Every number shown comes from the same /api/events query that drives the markers.
 */
export function ExplorePanel({
  filters, onChange, onClose, onSelect, onHover, focusedVenue, onClearFocus,
}: {
  filters: SearchFilters & { near: NonNullable<SearchFilters["near"]> };
  onChange: (f: SearchFilters) => void;
  onClose: () => void;
  onSelect: (c: EventCard) => void;
  onHover: (c: EventCard | null) => void;
  /** Venue picked on the map: its rows are highlighted and scrolled into view. */
  focusedVenue?: string | null;
  onClearFocus: () => void;
}) {
  const near = filters.near;
  const [tz, setTz] = useState<TzInfo | null>(null);
  const [radiusDraft, setRadiusDraft] = useState(near.radiusKm);
  const [res, setRes] = useState<{ items: EventCard[]; total: number; zones: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<"date" | "distance">("date");
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  // Phones start compact (place, radius, count) so the map and circle stay visible.
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth < 1024);
  const listRef = useRef<HTMLUListElement>(null);
  const set = (patch: Partial<SearchFilters>) => onChange({ ...filters, ...patch, page: undefined });

  useEffect(() => setRadiusDraft(near.radiusKm), [near.radiusKm]);

  // Debounce slider drags so we don't flood the server while the thumb moves.
  useEffect(() => {
    if (radiusDraft === near.radiusKm) return;
    const t = setTimeout(() => set({ near: { ...near, radiusKm: radiusDraft } }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiusDraft]);

  // Local time zone of the pin (for "today", labels and DST-correct offsets on the chosen date).
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/timezone?lat=${near.lat.toFixed(4)}&lng=${near.lng.toFixed(4)}${filters.from ? `&date=${filters.from}` : ""}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then(setTz)
      .catch(() => {});
    return () => ctrl.abort();
  }, [near.lat, near.lng, filters.from]);

  // Name the place if we only have coordinates.
  useEffect(() => {
    if (filters.nearLabel) return;
    const ctrl = new AbortController();
    fetch(`/api/geocode/reverse?lat=${near.lat.toFixed(5)}&lng=${near.lng.toFixed(5)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((j) => {
        const h: { kind: string; name: string }[] = j.place?.hierarchy ?? [];
        const city = h.find((x) => ["city", "town", "village"].includes(x.kind));
        const local = h.find((x) => ["district", "neighbourhood", "suburb", "locality"].includes(x.kind));
        const country = h.find((x) => x.kind === "country");
        const label = [local?.name, city?.name ?? country?.name].filter(Boolean).join(", ") || h[0]?.name;
        if (label) onChange({ ...filters, nearLabel: label });
      })
      .catch(() => {});
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near.lat, near.lng, filters.nearLabel]);

  // Results: same filters as the map markers. Older responses are cancelled, never applied.
  const query = filtersToParams({ ...filters, sort, page: undefined, pageSize: 60 }).toString();
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/events?${query}`, { signal: ctrl.signal })
        .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => null))?.error?.message ?? `HTTP ${r.status}`))))
        .then((j) => {
          setRes({ items: j.items, total: j.total, zones: [...new Set((j.items as EventCard[]).map((c) => c.timeZone))] });
          setError(null);
          setLoading(false);
        })
        .catch((e) => {
          if (e.name !== "AbortError") {
            setError(String(e.message));
            setLoading(false);
          }
        });
    }, 150);
    return () => (clearTimeout(t), ctrl.abort());
  }, [query, retry]);

  useEffect(() => {
    if (!focusedVenue) return;
    listRef.current?.querySelector(`[data-venue="${CSS.escape(focusedVenue)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedVenue, res]);

  const today = tz?.today ?? new Date().toISOString().slice(0, 10);
  const datePresets = useMemo(() => {
    const [ws, we] = weekendOf(today);
    return [
      { id: "any", label: "Any date", from: undefined, to: undefined },
      { id: "today", label: "Today", from: today, to: today },
      { id: "tomorrow", label: "Tomorrow", from: addDays(today, 1), to: addDays(today, 1) },
      { id: "weekend", label: "This weekend", from: ws, to: we },
      { id: "week", label: "Next 7 days", from: today, to: addDays(today, 6) },
    ];
  }, [today]);
  const activeDate = datePresets.find((p) => p.from === filters.from && p.to === filters.to)?.id ?? "custom";
  const activeTime = TIME_PRESETS.find((p) => p.from === filters.tFrom && p.to === filters.tTo)?.id ?? "custom";
  const nextRadius = RADIUS_PRESETS.find((r) => r > near.radiusKm * 1.2) ?? Math.min(RADIUS_MAX, near.radiusKm * 2);
  const summary = summarizeSearch(filters);
  const multiZone = (res?.zones.length ?? 0) > 1;

  return (
    <aside aria-label="Explore nearby" className="absolute z-30 inset-x-0 bottom-0 max-h-[68dvh] lg:inset-auto lg:right-6 lg:top-[calc(var(--header-h)+0.5rem)] lg:bottom-6 lg:w-[400px] lg:max-h-none surface-float rounded-t-[var(--radius-l)] lg:rounded-[var(--radius-l)] flex flex-col panel-slide">
      <button className="lg:hidden mx-auto mt-1 py-2 px-6" aria-label={collapsed ? "Show filters and results" : "Show less"} aria-expanded={!collapsed} onClick={() => setCollapsed((c) => !c)}>
        <span className="block h-1 w-10 rounded-full bg-line-strong" aria-hidden />
      </button>
      <div className="flex items-start gap-3 px-4 pt-3 pb-2">
        <Crosshair size={18} className="text-cyan mt-1 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="t-micro text-text-3">Exploring near</p>
          <h2 className="t-h2 truncate">{filters.nearLabel ?? "Selected location"}</h2>
          <p className="t-small text-text-2 tnum">{[formatKm(near.radiusKm), summary.when, summary.what].filter(Boolean).join(" · ")}</p>
          {collapsed && (
            <button className="lg:hidden t-small text-cyan mt-0.5 tnum" onClick={() => setCollapsed(false)}>
              {res ? `${res.total.toLocaleString()} ${res.total === 1 ? "event" : "events"} found` : "Searching"}, show filters and results
            </button>
          )}
        </div>
        <button className="btn btn-ghost btn-icon btn-sm -mr-1" aria-label="Stop exploring this area" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className={`overflow-auto scroll-thin px-4 pb-4 flex-1 ${collapsed ? "hidden lg:block" : ""}`}>
        {/* ---- radius ---- */}
        <fieldset className="py-2">
          <legend className="flex w-full items-baseline justify-between t-small">
            <span className="text-text-2">Search radius</span>
            <span className="font-semibold tnum">{formatKm(radiusDraft)}</span>
          </legend>
          <input
            type="range"
            min={0}
            max={1000}
            value={kmToSlider(radiusDraft)}
            onChange={(e) => setRadiusDraft(sliderToKm(+e.target.value))}
            aria-label="Search radius"
            aria-valuetext={formatKm(radiusDraft)}
            className="w-full mt-2 accent-[var(--cyan)]"
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {RADIUS_PRESETS.map((r) => (
              <button key={r} type="button" className="chip !h-7 !px-2.5 tnum" aria-pressed={near.radiusKm === r} onClick={() => (setRadiusDraft(r), set({ near: { ...near, radiusKm: r } }))}>
                {r} km
              </button>
            ))}
          </div>
        </fieldset>

        {/* ---- date ---- */}
        <fieldset className="py-2 border-t border-line">
          <legend className="t-small text-text-2 mb-1.5 pt-2">Date</legend>
          <div className="flex flex-wrap gap-1">
            {datePresets.map((p) => (
              <button key={p.id} type="button" className="chip !h-7 !px-2.5" aria-pressed={activeDate === p.id} onClick={() => set({ from: p.from, to: p.to })}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="t-micro text-text-3">
              From
              <input type="date" className="field !h-8 mt-1" value={filters.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined, to: filters.to && e.target.value > filters.to ? e.target.value : filters.to ?? (e.target.value || undefined) })} />
            </label>
            <label className="t-micro text-text-3">
              To
              <input type="date" className="field !h-8 mt-1" min={filters.from} value={filters.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined, from: filters.from ?? (e.target.value || undefined) })} />
            </label>
          </div>
        </fieldset>

        {/* ---- local time ---- */}
        <fieldset className="py-2 border-t border-line">
          <legend className="t-small text-text-2 mb-1.5 pt-2 flex items-center gap-1.5">
            <Clock size={13} aria-hidden /> Local time
          </legend>
          <div className="flex flex-wrap gap-1">
            {TIME_PRESETS.map((p) => (
              <button key={p.id} type="button" className="chip !h-7 !px-2.5" aria-pressed={activeTime === p.id} onClick={() => set({ tFrom: p.from, tTo: p.to })}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="t-micro text-text-3">
              Starts after
              <input type="time" step={900} className="field !h-8 mt-1 tnum" value={filters.tFrom ?? ""} onChange={(e) => set({ tFrom: e.target.value || undefined })} />
            </label>
            <label className="t-micro text-text-3">
              Until
              <input type="time" step={900} className="field !h-8 mt-1 tnum" value={filters.tTo ?? ""} onChange={(e) => set({ tTo: e.target.value || undefined })} />
            </label>
          </div>
          <p className="t-micro text-text-3 mt-2 flex gap-1.5">
            <Info size={12} className="shrink-0 mt-px" aria-hidden />
            <span>
              {tz ? (
                <>
                  Times are local to each venue. Here that&apos;s <span className="text-text-2">{tz.timeZone.replace(/_/g, " ")}</span> ({tz.label}
                  {filters.from ? ` on ${new Date(`${filters.from}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : ""}), now {tz.localNow}.
                </>
              ) : (
                "Times are local to each venue."
              )}
              {multiZone && " This area spans several time zones, so each event is matched in its own."}
              {filters.tFrom && filters.tTo && filters.tTo <= filters.tFrom && " The window runs past midnight."}
            </span>
          </p>
        </fieldset>

        {/* ---- results ---- */}
        <div className="pt-3 border-t border-line">
          <div className="flex items-center justify-between gap-2">
            <p className="t-h3 tnum flex items-center gap-2" aria-live="polite">
              {loading && <Loader2 size={14} className="animate-spin text-text-3" aria-hidden />}
              {res ? `${res.total.toLocaleString()} ${res.total === 1 ? "event" : "events"} found` : "Searching"}
            </p>
            <label className="sr-only" htmlFor="explore-sort">Sort results</label>
            <select id="explore-sort" className="field !h-7 !w-auto !text-[12px]" value={sort} onChange={(e) => setSort(e.target.value as "date" | "distance")}>
              <option value="date">Starting soonest</option>
              <option value="distance">Nearest first</option>
            </select>
          </div>
          {focusedVenue && (
            <p className="t-micro text-text-2 mt-1 flex items-center gap-2">
              Showing a venue you picked on the map.
              <button className="underline hover:text-text" onClick={onClearFocus}>Clear</button>
            </p>
          )}
          {error && (
            <div className="mt-3">
              <ErrorState title="Couldn't load events for this area" body={error} onRetry={() => setRetry((r) => r + 1)} />
            </div>
          )}
          {!error && res && res.total === 0 && (
            <div className="mt-3 rounded-[var(--radius-m)] border border-dashed border-line-strong p-3">
              <p className="t-small font-medium">
                No events found within {formatKm(near.radiusKm)}
                {summary.when ? ` for ${summary.when}` : ""}.
              </p>
              <p className="t-micro text-text-3 mt-0.5">Our sources don&apos;t cover every event, so try widening the search.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {near.radiusKm < RADIUS_MAX && <button className="chip !h-7" onClick={() => set({ near: { ...near, radiusKm: nextRadius } })}>Expand to {formatKm(nextRadius)}</button>}
                {(filters.tFrom || filters.tTo) && <button className="chip !h-7" onClick={() => set({ tFrom: undefined, tTo: undefined })}>Any time of day</button>}
                {(filters.from || filters.to) && <button className="chip !h-7" onClick={() => set({ from: undefined, to: undefined })}>Any date</button>}
                {filters.categories?.length ? <button className="chip !h-7" onClick={() => set({ categories: undefined })}>All categories</button> : null}
              </div>
            </div>
          )}
          {res && res.items.length > 0 && (
            <ul ref={listRef} className="divide-y divide-line mt-1">
              {res.items.map((c) => (
                <EventRow key={c.id} c={c} compact onSelect={onSelect} onHover={onHover} highlighted={focusedVenue === c.venueSlug} />
              ))}
            </ul>
          )}
          {res && res.total > res.items.length && (
            <p className="t-micro text-text-3 mt-2">Showing the first {res.items.length}. Open the full list to see all {res.total.toLocaleString()}.</p>
          )}
        </div>
      </div>

      <div className={`border-t border-line px-4 py-3 grid gap-2 ${collapsed ? "hidden lg:grid" : ""}`}>
        {saving ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              userActions.saveSearch(saveName || summary.text, filtersToParams({ ...filters, page: undefined, sort: undefined }).toString(), summary.text);
              setSaving(false);
              setSaved(true);
              setTimeout(() => setSaved(false), 2500);
            }}
          >
            <label className="sr-only" htmlFor="save-name">Name this search</label>
            <input id="save-name" autoFocus className="field !h-8" placeholder={`e.g. Evenings near ${filters.nearLabel?.split(",")[0] ?? "here"}`} value={saveName} onChange={(e) => setSaveName(e.target.value)} />
            <button className="btn btn-primary btn-sm">Save</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSaving(false)}>Cancel</button>
          </form>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Link href={`/events?${filtersToParams({ ...filters, sort: sort === "distance" ? "distance" : undefined, page: undefined }).toString()}`} className="btn btn-secondary btn-sm">
              <ListFilter size={14} aria-hidden /> Full list
            </Link>
            <button className="btn btn-secondary btn-sm" onClick={() => setSaving(true)}>
              {saved ? <Check size={14} aria-hidden /> : <Bookmark size={14} aria-hidden />}
              {saved ? "Saved to My World" : "Save search"}
            </button>
          </div>
        )}
        {saved && <p className="t-micro text-text-3">Saved in this browser. Find it in My World under Saved searches.</p>}
      </div>
    </aside>
  );
}
