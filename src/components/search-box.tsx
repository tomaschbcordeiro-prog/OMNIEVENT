"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, MapPin, Tag, User, Building2, CalendarDays, History, Loader2, X, Navigation } from "lucide-react";
import { zoomForKind } from "@/lib/map/view";
import { parseQuery } from "@/lib/search/parse";
import { filtersToParams } from "@/lib/search/params";
import { userActions, useUser } from "@/lib/user/store";
import { formatShortDate } from "@/lib/format";
import type { ParsedQuery } from "@/lib/types";
import { DemoBadge } from "./ui";

interface Suggest {
  destinations: { id: string; slug: string; name: string; kind: string; country?: string; lat: number; lng: number; events?: number }[];
  categories: { slug: string; name: string; parent?: string }[];
  participants: { slug: string; name: string; kind: string; isDemo: boolean }[];
  venues: { slug: string; name: string; city: string; isDemo: boolean }[];
  events: { slug: string; title: string; city: string; start: string; timeZone: string; isDemo: boolean }[];
}

type Item = { key: string; label: string; sub?: string; icon: React.ReactNode; demo?: boolean; run: () => void; section?: string };

/** A real place from the geocoder (address, street, landmark, city, country, coordinates). */
export interface GeoPlace {
  id: string;
  name: string;
  context: string;
  kind: string;
  lat: number;
  lng: number;
  bbox?: [number, number, number, number];
}

export interface SearchBoxProps {
  /** When provided, the parsed query is handed to the caller (e.g. the globe) instead of navigating. */
  onQuery?: (parsed: ParsedQuery, raw: string) => void;
  onPlace?: (d: { id: string; name: string; kind: string; lat: number; lng: number }) => void;
  /** Real-world place picked from geocoder results. Without it, the home map opens at that place. */
  onGeoPlace?: (g: GeoPlace) => void;
  /** Bias place results towards what the person is looking at. */
  mapCenter?: { lat: number; lng: number };
  placeholder?: string;
  size?: "md" | "lg";
  autoFocus?: boolean;
  initial?: string;
  className?: string;
}

export function SearchBox({ onQuery, onPlace, onGeoPlace, mapCenter, placeholder, size = "md", autoFocus, initial = "", className = "" }: SearchBoxProps) {
  const router = useRouter();
  const user = useUser();
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Suggest | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(-1);
  const [geo, setGeo] = useState<{ results: GeoPlace[]; loading: boolean; failed: boolean }>({ results: [], loading: false, failed: false });
  const centerRef = useRef(mapCenter);
  centerRef.current = mapCenter;
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Debounced, cancellable autocomplete.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setData(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        setData(await res.json());
        setFailed(false);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFailed(true);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  // Real places (debounced separately: the geocoder is slower and rate limited).
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setGeo({ results: [], loading: false, failed: false });
      return;
    }
    const ctrl = new AbortController();
    setGeo((g) => ({ ...g, loading: true }));
    const t = setTimeout(async () => {
      try {
        const c = centerRef.current;
        const bias = c ? `&lat=${c.lat.toFixed(2)}&lng=${c.lng.toFixed(2)}` : "";
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(term)}&limit=5${bias}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const j = await res.json();
        setGeo({ results: j.results, loading: false, failed: false });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setGeo({ results: [], loading: false, failed: true });
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const parsed = useMemo(() => (q.trim().length > 2 ? parseQuery(q, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) : null), [q]);

  const submit = (raw = q) => {
    const text = raw.trim();
    if (!text) return;
    userActions.searched(text);
    setOpen(false);
    const p = parseQuery(text, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    if (onQuery) return onQuery(p, text);
    const params = filtersToParams(p.filters);
    params.set("asked", text);
    router.push(`/events?${params.toString()}`);
  };

  const items: Item[] = [];
  const term = q.trim();
  if (term.length >= 2) {
    items.push({
      key: "search",
      label: `Search for “${term}”`,
      sub: parsed?.interpretation.length ? parsed.interpretation.map((i) => i.label).join(", ") : undefined,
      icon: <Search size={15} aria-hidden />,
      run: () => submit(),
    });
    geo.results.forEach((g) =>
      items.push({
        key: `g-${g.id}`,
        label: g.name,
        sub: g.context || g.kind,
        section: "Places and addresses",
        icon: <Navigation size={15} aria-hidden />,
        run: () => {
          setOpen(false);
          userActions.searched(g.name);
          if (onGeoPlace) onGeoPlace(g);
          else router.push(`/?at=${g.lat.toFixed(5)},${g.lng.toFixed(5)},${zoomForKind(g.kind)}&pin=${g.lat.toFixed(5)},${g.lng.toFixed(5)}`);
        },
      }),
    );
    data?.destinations.forEach((d) =>
      items.push({
        key: `d-${d.id}`,
        label: d.name,
        sub: [d.kind === "city" ? d.country : d.kind, d.events ? `${d.events} upcoming` : undefined].filter(Boolean).join(", "),
        icon: <MapPin size={15} aria-hidden />,
        run: () => {
          setOpen(false);
          if (onPlace) onPlace(d);
          else router.push(`/destinations/${d.slug}`);
        },
      }),
    );
    data?.categories.forEach((c) =>
      items.push({ key: `c-${c.slug}`, label: c.name, sub: "Category", icon: <Tag size={15} aria-hidden />, run: () => (setOpen(false), router.push(`/categories/${c.parent ?? c.slug}${c.parent ? `?sub=${c.slug}` : ""}`)) }),
    );
    data?.participants.forEach((p) =>
      items.push({ key: `p-${p.slug}`, label: p.name, sub: p.kind, demo: p.isDemo, icon: <User size={15} aria-hidden />, run: () => (setOpen(false), router.push(`/participants/${p.slug}`)) }),
    );
    data?.venues.forEach((v) =>
      items.push({ key: `v-${v.slug}`, label: v.name, sub: v.city, demo: v.isDemo, icon: <Building2 size={15} aria-hidden />, run: () => (setOpen(false), router.push(`/venues/${v.slug}`)) }),
    );
    data?.events.forEach((e) => {
      const d = formatShortDate(e.start, e.timeZone);
      items.push({ key: `e-${e.slug}`, label: e.title, sub: `${e.city}, ${d.day} ${d.month}`, demo: e.isDemo, icon: <CalendarDays size={15} aria-hidden />, run: () => (setOpen(false), router.push(`/events/${e.slug}`)) });
    });
  } else {
    user.recentSearches.forEach((s) => items.push({ key: `r-${s}`, label: s, icon: <History size={15} aria-hidden />, run: () => (setQ(s), submit(s)) }));
  }

  const examples = ["Concerts in Lisbon next month", "Football in London this weekend", "Family activities in Paris under €50", "Tech conferences in Berlin"];

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (active >= 0 && items[active]) items[active].run();
          else submit();
        }}
      >
        <label htmlFor={`${listId}-input`} className="sr-only">
          Search events, artists, teams, venues and places
        </label>
        <div className={`flex items-center gap-2 border bg-panel focus-within:border-cyan focus-within:shadow-[0_0_0_4px_rgb(20_99_255_/_0.18)] ${size === "lg" ? "h-14 px-5 rounded-full border-white shadow-[0_12px_32px_-12px_rgb(10_50_120_/_0.45)]" : "h-9 px-3 rounded-full border-line-strong"}`}>
          {loading ? <Loader2 size={size === "lg" ? 19 : 16} className="animate-spin text-cyan shrink-0" aria-hidden /> : <Search size={size === "lg" ? 19 : 16} className={`shrink-0 ${size === "lg" ? "text-cyan" : "text-text-3"}`} aria-hidden />}
          <input
            ref={input}
            id={`${listId}-input`}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            autoComplete="off"
            autoFocus={autoFocus}
            value={q}
            placeholder={placeholder ?? "Search events, artists, teams, venues or places"}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setActive((a) => Math.min(items.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(-1, a - 1));
              } else if (e.key === "Escape") {
                setOpen(false);
                setActive(-1);
              }
            }}
            className={`flex-1 min-w-0 bg-transparent outline-none placeholder:text-text-3 ${size === "lg" ? "text-[17px]" : "text-sm"}`}
          />
          {q && (
            <button type="button" aria-label="Clear search" className="text-text-3 hover:text-text" onClick={() => (setQ(""), input.current?.focus())}>
              <X size={15} aria-hidden />
            </button>
          )}
        </div>
      </form>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 surface-float rounded-[var(--radius-m)] overflow-hidden panel-in">
          {items.length > 0 && (
            <ul id={listId} role="listbox" className="max-h-[60vh] overflow-auto scroll-thin py-1">
              {term.length < 2 && (
                <li className="flex items-center justify-between px-3 pt-1.5 pb-1 text-[12px] text-text-3">
                  <span>Recent searches</span>
                  <button type="button" className="hover:text-text" onClick={() => userActions.clearSearches()}>
                    Clear
                  </button>
                </li>
              )}
              {items.map((it, i) => [
                it.section && it.section !== items[i - 1]?.section ? (
                  <li key={`h-${it.section}`} role="presentation" className="px-3 pt-2 pb-0.5 text-[11px] text-text-3">{it.section}</li>
                ) : it.section === undefined && items[i - 1]?.section ? (
                  <li key={`h-events-${i}`} role="presentation" className="px-3 pt-2 pb-0.5 text-[11px] text-text-3">Events, people and venues</li>
                ) : null,
                <li
                  key={it.key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={it.run}
                  onMouseEnter={() => setActive(i)}
                  className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer ${i === active ? "bg-text/[0.06]" : ""}`}
                >
                  <span className="text-text-3">{it.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{it.label}</span>
                    {it.sub && <span className="block truncate text-[12px] text-text-3 capitalize-first">{it.sub}</span>}
                  </span>
                  {it.demo && <DemoBadge />}
                </li>,
              ])}
            </ul>
          )}
          {term.length >= 2 && !loading && data && items.length === 1 && (
            <p className="px-3 pb-2 text-[12px] text-text-3">No matching places, people or venues. Press Enter to search all events.</p>
          )}
          {failed && <p className="px-3 pb-2 text-[12px] text-bad">Suggestions are unavailable right now. Press Enter to search anyway.</p>}
          {geo.failed && term.length >= 3 && <p className="px-3 pb-2 text-[12px] text-text-3">Address search is unavailable right now.</p>}
          {geo.loading && term.length >= 3 && !geo.results.length && <p className="px-3 pb-2 text-[12px] text-text-3">Looking up places</p>}
          {term.length < 2 && (
            <div className="px-3 py-2.5 border-t border-line">
              <p className="text-[12px] text-text-3 mb-2">Try asking in plain words</p>
              <div className="flex flex-wrap gap-1.5">
                {examples.map((ex) => (
                  <button key={ex} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => (setQ(ex), submit(ex))}>
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
