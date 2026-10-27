"use client";

import { setRangeEdge } from "@/lib/date-range";
import { X, Crosshair, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { TIME_PRESETS } from "@/lib/time";
import { formatKm, kmToSlider, sliderToKm, RADIUS_PRESETS } from "@/lib/map/circle";
import type { SearchFilters, EventStatus } from "@/lib/types";
import { GROUPS } from "@/lib/categories";
import { CITIES, COUNTRIES, getDestination } from "@/lib/destinations";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { STATUS_META } from "@/lib/format";
import { activeFilterCount } from "@/lib/search/params";
import { ShapeGlyph } from "../ui";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function datePresets(): { id: string; label: string; from: string; to: string }[] {
  const t = new Date();
  const today = new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()));
  const dow = today.getUTCDay();
  const add = (n: number) => new Date(today.getTime() + n * 86400000);
  const fri = dow === 0 ? today : dow === 6 ? today : add(5 - dow);
  const sun = dow === 0 ? today : add(7 - dow);
  return [
    { id: "today", label: "Today", from: ymd(today), to: ymd(today) },
    { id: "weekend", label: "This weekend", from: ymd(fri), to: ymd(sun) },
    { id: "week", label: "Next 7 days", from: ymd(today), to: ymd(add(6)) },
    { id: "month", label: "Next 30 days", from: ymd(today), to: ymd(add(29)) },
  ];
}

/**
 * Full filter form. Controlled: every change produces a new SearchFilters
 * object, which the parent writes to the URL and uses to re-query.
 */
export function FilterForm({ f, onChange, showCategories = true }: { f: SearchFilters; onChange: (f: SearchFilters) => void; showCategories?: boolean }) {
  const set = (patch: Partial<SearchFilters>) => onChange({ ...f, ...patch, page: undefined });
  const presets = datePresets();
  const activePreset = presets.find((p) => p.from === f.from && p.to === f.to)?.id;
  const placeValue = f.city ? `city:${f.city}` : f.country ? `country:${f.country}` : f.continent ? `continent:${f.continent}` : "";

  return (
    <div className="grid gap-5">
      {showCategories && (
        <fieldset>
          <legend className="label">Categories</legend>
          <div className="flex flex-wrap gap-1.5">
            {GROUPS.filter((g) => g.slug !== "other").map((g) => {
              const on = f.categories?.includes(g.slug) ?? false;
              return (
                <button
                  key={g.slug}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  onClick={() => set({ categories: on ? f.categories!.filter((c) => c !== g.slug) : [...(f.categories ?? []), g.slug] })}
                >
                  <ShapeGlyph group={g.slug} size={9} />
                  {g.name.replace(" & Performing Arts", "").replace(" & Business", "")}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend className="label">Dates</legend>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {presets.map((p) => (
            <button key={p.id} type="button" className="chip" aria-pressed={activePreset === p.id} onClick={() => set(activePreset === p.id ? { from: undefined, to: undefined } : { from: p.from, to: p.to })}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="f-from">From</label>
            <input id="f-from" type="date" className="field" value={f.from ?? ""} onChange={(e) => set(setRangeEdge("from", e.target.value, f))} />
          </div>
          <div>
            <label className="label" htmlFor="f-to">To</label>
            <input id="f-to" type="date" className="field" min={f.from} value={f.to ?? ""} onChange={(e) => set(setRangeEdge("to", e.target.value, f))} />
          </div>
        </div>
      </fieldset>

      <div>
        <label className="label" htmlFor="f-place">Place</label>
        <select
          id="f-place"
          className="field"
          value={placeValue}
          onChange={(e) => {
            const [kind, id] = e.target.value.split(":");
            set({ city: kind === "city" ? id : undefined, country: kind === "country" ? id : undefined, continent: kind === "continent" ? id : undefined });
          }}
        >
          <option value="">Anywhere</option>
          <optgroup label="Continents">
            {["europe", "north-america", "south-america", "asia", "africa", "oceania"].map((c) => (
              <option key={c} value={`continent:${c}`}>{getDestination(c)?.name}</option>
            ))}
          </optgroup>
          <optgroup label="Countries">
            {[...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
              <option key={c.id} value={`country:${c.countryCode}`}>{c.name}</option>
            ))}
          </optgroup>
          <optgroup label="Cities">
            {[...CITIES].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
              <option key={c.id} value={`city:${c.id}`}>{c.name}, {c.country}</option>
            ))}
          </optgroup>
        </select>
      </div>

      <NearPlace f={f} set={set} />

      <fieldset>
        <legend className="label">Local time</legend>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {TIME_PRESETS.map((p) => (
            <button key={p.id} type="button" className="chip" aria-pressed={(p.from ?? "") === (f.tFrom ?? "") && (p.to ?? "") === (f.tTo ?? "")} onClick={() => set({ tFrom: p.from, tTo: p.to })}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="f-tfrom">Starts after</label>
            <input id="f-tfrom" type="time" step={900} className="field tnum" value={f.tFrom ?? ""} onChange={(e) => set({ tFrom: e.target.value || undefined })} />
          </div>
          <div>
            <label className="label" htmlFor="f-tto">Until</label>
            <input id="f-tto" type="time" step={900} className="field tnum" value={f.tTo ?? ""} onChange={(e) => set({ tTo: e.target.value || undefined })} />
          </div>
        </div>
        <p className="t-micro text-text-3 mt-1.5">Times are the local time at each venue. An end before the start runs past midnight.</p>
      </fieldset>

      <fieldset>
        <legend className="label">Price per ticket</legend>
        <div className="grid grid-cols-[1fr_1fr_5.5rem] gap-2">
          <input aria-label="Minimum price" inputMode="decimal" type="number" min={0} className="field tnum" placeholder="Min" value={f.minPrice ?? ""} onChange={(e) => set({ minPrice: e.target.value === "" ? undefined : Math.max(0, +e.target.value) })} />
          <input aria-label="Maximum price" inputMode="decimal" type="number" min={0} className="field tnum" placeholder="Max" value={f.maxPrice ?? ""} onChange={(e) => set({ maxPrice: e.target.value === "" ? undefined : Math.max(0, +e.target.value) })} />
          <select aria-label="Price currency" className="field" value={f.currency ?? ""} onChange={(e) => set({ currency: e.target.value || undefined })}>
            <option value="">Local</option>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <p className="t-micro text-text-3 mt-1.5">
          “Local” compares each event in its own currency. Choosing a currency converts using approximate static rates. Events with no published price are left out when a price filter is set.
        </p>
      </fieldset>

      <fieldset>
        <legend className="label">Entry</legend>
        <div className="flex flex-wrap gap-1.5">
          {([["ticketed", "Ticketed"], ["free", "Free"], ["registration", "Registration"]] as const).map(([v, l]) => (
            <button key={v} type="button" className="chip" aria-pressed={f.access === v} onClick={() => set({ access: f.access === v ? undefined : v })}>{l}</button>
          ))}
          <button type="button" className="chip" aria-pressed={!!f.family} onClick={() => set({ family: f.family ? undefined : true })}>Family-friendly</button>
          <button type="button" className="chip" aria-pressed={!!f.accessible} onClick={() => set({ accessible: f.accessible ? undefined : true })}>Accessibility info</button>
        </div>
      </fieldset>

      <fieldset>
        <legend className="label">Setting</legend>
        <div className="flex flex-wrap gap-1.5">
          {([["indoor", "Indoor"], ["outdoor", "Outdoor"]] as const).map(([v, l]) => (
            <button key={v} type="button" className="chip" aria-pressed={f.indoor === v} onClick={() => set({ indoor: f.indoor === v ? undefined : v })}>{l}</button>
          ))}
          {([["in_person", "In person"], ["online", "Online"]] as const).map(([v, l]) => (
            <button key={v} type="button" className="chip" aria-pressed={f.online === v} onClick={() => set({ online: f.online === v ? undefined : v })}>{l}</button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label">Status</legend>
        <div className="flex flex-wrap gap-1.5">
          {(["on_sale", "scheduled", "sold_out", "postponed", "rescheduled", "cancelled"] as EventStatus[]).map((s) => {
            const on = f.status?.includes(s) ?? false;
            return (
              <button key={s} type="button" className="chip" aria-pressed={on} onClick={() => set({ status: on ? f.status!.filter((x) => x !== s) : [...(f.status ?? []), s] })}>
                {STATUS_META[s].label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label className="label" htmlFor="f-source">Data source</label>
        <select id="f-source" className="field" value={f.source ?? "all"} onChange={(e) => set({ source: e.target.value as SearchFilters["source"] })}>
          <option value="all">All sources</option>
          <option value="live">Live provider data only</option>
          <option value="demo">Demo data only</option>
        </select>
      </div>
    </div>
  );
}

/** "Near a place": search any address or city, then choose a radius. Uses the same geocoder as the map. */
function NearPlace({ f, set }: { f: SearchFilters; set: (p: Partial<SearchFilters>) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; context: string; lat: number; lng: number }[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (q.trim().length < 3) return setResults([]);
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/geocode?q=${encodeURIComponent(q.trim())}&limit=5`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
        .then((j) => (setResults(j.results), setLoading(false)))
        .catch((e) => e.name !== "AbortError" && (setResults([]), setLoading(false)));
    }, 350);
    return () => (clearTimeout(t), ctrl.abort());
  }, [q]);
  return (
    <fieldset>
      <legend className="label">Near a place</legend>
      {f.near ? (
        <div className="rounded-[var(--radius-m)] border border-line-strong p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="t-small flex items-center gap-1.5 min-w-0">
              <Crosshair size={14} className="text-cyan shrink-0" aria-hidden />
              <span className="truncate">{f.nearLabel ?? `${f.near.lat.toFixed(3)}, ${f.near.lng.toFixed(3)}`}</span>
            </p>
            <button type="button" className="t-micro text-text-3 hover:text-text" onClick={() => set({ near: undefined, nearLabel: undefined, sort: f.sort === "distance" ? undefined : f.sort })}>Remove</button>
          </div>
          <label className="t-micro text-text-3 mt-2 flex justify-between" htmlFor="f-radius">
            Radius <span className="text-text tnum">{formatKm(f.near.radiusKm)}</span>
          </label>
          <input id="f-radius" type="range" min={0} max={1000} value={kmToSlider(f.near.radiusKm)} onChange={(e) => set({ near: { ...f.near!, radiusKm: sliderToKm(+e.target.value) } })} className="w-full accent-[var(--cyan)]" />
          <div className="mt-1 flex flex-wrap gap-1">
            {RADIUS_PRESETS.slice(0, 6).map((r) => (
              <button key={r} type="button" className="chip !h-6 !px-2 !text-[12px] tnum" aria-pressed={f.near!.radiusKm === r} onClick={() => set({ near: { ...f.near!, radiusKm: r } })}>{r} km</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="relative">
          <input className="field" placeholder="City, neighbourhood or address" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search for a place to search around" />
          {loading && <Loader2 size={14} className="absolute right-3 top-3 animate-spin text-text-3" aria-hidden />}
          {results.length > 0 && (
            <ul className="mt-1 rounded-[var(--radius-m)] border border-line-strong bg-panel divide-y divide-line overflow-hidden">
              {results.map((r) => (
                <li key={r.id}>
                  <button type="button" className="w-full text-left px-3 py-2 hover:bg-text/5" onClick={() => (set({ near: { lat: r.lat, lng: r.lng, radiusKm: 10 }, nearLabel: [r.name, r.context.split(",").slice(-2).join(",").trim()].filter(Boolean).join(", "), city: undefined, country: undefined, continent: undefined }), setQ(""), setResults([]))}>
                    <span className="block t-small">{r.name}</span>
                    <span className="block t-micro text-text-3 truncate">{r.context}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </fieldset>
  );
}

/** Removable chips summarising active filters. */
export function ActiveFilters({ f, onChange }: { f: SearchFilters; onChange: (f: SearchFilters) => void }) {
  const chips: { k: string; label: string; clear: Partial<SearchFilters> }[] = [];
  if (f.q) chips.push({ k: "q", label: `“${f.q}”`, clear: { q: undefined } });
  f.categories?.forEach((c) => chips.push({ k: `c-${c}`, label: GROUPS.find((g) => g.slug === c)?.name ?? c.replace(/-/g, " "), clear: { categories: f.categories!.filter((x) => x !== c) } }));
  const day = (ymd?: string) => (ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "…");
  if (f.live) chips.push({ k: "live", label: "On now", clear: { live: undefined } });
  f.places?.forEach((p) => chips.push({ k: `pl-${p}`, label: getDestination(p)?.name ?? p, clear: { places: f.places!.filter((x) => x !== p).length ? f.places!.filter((x) => x !== p) : undefined } }));
  f.anyOf?.forEach((w) => chips.push({ k: `any-${w}`, label: GROUPS.find((g) => g.slug === w)?.name ?? `“${w}”`, clear: { anyOf: f.anyOf!.filter((x) => x !== w).length ? f.anyOf!.filter((x) => x !== w) : undefined } }));
  if (f.from || f.to) chips.push({ k: "date", label: f.from === f.to ? day(f.from) : `${day(f.from)} to ${day(f.to)}`, clear: { from: undefined, to: undefined } });
  if (f.city) chips.push({ k: "city", label: getDestination(f.city)?.name ?? f.city, clear: { city: undefined } });
  if (f.country) chips.push({ k: "country", label: COUNTRIES.find((c) => c.countryCode === f.country)?.name ?? f.country, clear: { country: undefined } });
  if (f.continent) chips.push({ k: "continent", label: getDestination(f.continent)?.name ?? f.continent, clear: { continent: undefined } });
  if (f.near) chips.push({ k: "near", label: `${f.nearLabel ? `${f.nearLabel.split(",")[0]}, ` : ""}within ${formatKm(f.near.radiusKm)}`, clear: { near: undefined, nearLabel: undefined } });
  if (f.tFrom || f.tTo) chips.push({ k: "time", label: `${f.tFrom ?? "00:00"}–${f.tTo ?? "24:00"} local`, clear: { tFrom: undefined, tTo: undefined } });
  if (f.minPrice != null || f.maxPrice != null)
    chips.push({ k: "price", label: `${f.currency ?? "Local"} ${f.minPrice ?? 0}–${f.maxPrice ?? "any"}`, clear: { minPrice: undefined, maxPrice: undefined, currency: undefined } });
  if (f.access) chips.push({ k: "access", label: f.access === "free" ? "Free" : f.access === "registration" ? "Registration" : "Ticketed", clear: { access: undefined } });
  if (f.family) chips.push({ k: "family", label: "Family-friendly", clear: { family: undefined } });
  if (f.accessible) chips.push({ k: "acc", label: "Accessibility info", clear: { accessible: undefined } });
  if (f.indoor) chips.push({ k: "indoor", label: f.indoor === "indoor" ? "Indoor" : "Outdoor", clear: { indoor: undefined } });
  if (f.online) chips.push({ k: "online", label: f.online === "online" ? "Online" : "In person", clear: { online: undefined } });
  f.status?.forEach((s) => chips.push({ k: `s-${s}`, label: STATUS_META[s].label, clear: { status: f.status!.filter((x) => x !== s) } }));
  if (f.source && f.source !== "all") chips.push({ k: "src", label: f.source === "demo" ? "Demo data" : "Live data", clear: { source: undefined } });
  if (f.sport) chips.push({ k: "sport", label: f.sport, clear: { sport: undefined } });
  if (f.competition) chips.push({ k: "comp", label: f.competition, clear: { competition: undefined } });
  if (f.participant) chips.push({ k: "participant", label: `Participant: ${f.participant}`, clear: { participant: undefined } });
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {chips.map((c) => (
        <button key={c.k} type="button" className="chip" data-active="true" onClick={() => onChange({ ...f, ...c.clear, page: undefined })} aria-label={`Remove filter ${c.label}`}>
          {c.label}
          <X size={13} aria-hidden />
        </button>
      ))}
      {activeFilterCount(f) + (f.q ? 1 : 0) > 1 && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ sort: f.sort })}>
          Clear all
        </button>
      )}
    </div>
  );
}
