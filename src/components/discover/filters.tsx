"use client";

import { X } from "lucide-react";
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
            <input id="f-from" type="date" className="field" value={f.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined, to: f.to && e.target.value > f.to ? e.target.value : f.to })} />
          </div>
          <div>
            <label className="label" htmlFor="f-to">To</label>
            <input id="f-to" type="date" className="field" min={f.from} value={f.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} />
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

      {f.near && (
        <div>
          <label className="label" htmlFor="f-radius">Distance from selected point: {f.near.radiusKm} km</label>
          <input id="f-radius" type="range" min={5} max={500} step={5} value={f.near.radiusKm} onChange={(e) => set({ near: { ...f.near!, radiusKm: +e.target.value } })} className="w-full accent-[var(--cyan)]" />
          <button type="button" className="btn btn-ghost btn-sm mt-1 -ml-2" onClick={() => set({ near: undefined, sort: f.sort === "distance" ? undefined : f.sort })}>
            Remove distance filter
          </button>
        </div>
      )}

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

/** Removable chips summarising active filters. */
export function ActiveFilters({ f, onChange }: { f: SearchFilters; onChange: (f: SearchFilters) => void }) {
  const chips: { k: string; label: string; clear: Partial<SearchFilters> }[] = [];
  if (f.q) chips.push({ k: "q", label: `“${f.q}”`, clear: { q: undefined } });
  f.categories?.forEach((c) => chips.push({ k: `c-${c}`, label: GROUPS.find((g) => g.slug === c)?.name ?? c.replace(/-/g, " "), clear: { categories: f.categories!.filter((x) => x !== c) } }));
  if (f.from || f.to) chips.push({ k: "date", label: f.from === f.to ? f.from! : `${f.from ?? "…"} to ${f.to ?? "…"}`, clear: { from: undefined, to: undefined } });
  if (f.city) chips.push({ k: "city", label: getDestination(f.city)?.name ?? f.city, clear: { city: undefined } });
  if (f.country) chips.push({ k: "country", label: COUNTRIES.find((c) => c.countryCode === f.country)?.name ?? f.country, clear: { country: undefined } });
  if (f.continent) chips.push({ k: "continent", label: getDestination(f.continent)?.name ?? f.continent, clear: { continent: undefined } });
  if (f.near) chips.push({ k: "near", label: `Within ${f.near.radiusKm} km`, clear: { near: undefined } });
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
