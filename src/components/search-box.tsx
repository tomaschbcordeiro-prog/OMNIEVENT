"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, MapPin, Tag, User, Building2, CalendarDays, History, Loader2, X } from "lucide-react";
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

type Item = { key: string; label: string; sub?: string; icon: React.ReactNode; demo?: boolean; run: () => void };

export interface SearchBoxProps {
  /** When provided, the parsed query is handed to the caller (e.g. the globe) instead of navigating. */
  onQuery?: (parsed: ParsedQuery, raw: string) => void;
  onPlace?: (d: { id: string; name: string; kind: string; lat: number; lng: number }) => void;
  placeholder?: string;
  size?: "md" | "lg";
  autoFocus?: boolean;
  initial?: string;
  className?: string;
}

export function SearchBox({ onQuery, onPlace, placeholder, size = "md", autoFocus, initial = "", className = "" }: SearchBoxProps) {
  const router = useRouter();
  const user = useUser();
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Suggest | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(-1);
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
        <div className={`flex items-center gap-2 rounded-[var(--radius-m)] border border-line-strong bg-bg-2/90 focus-within:border-cyan focus-within:shadow-[0_0_0_3px_rgb(66_223_255_/_0.15)] ${size === "lg" ? "h-12 px-4" : "h-9 px-3"}`}>
          {loading ? <Loader2 size={16} className="animate-spin text-text-3 shrink-0" aria-hidden /> : <Search size={16} className="text-text-3 shrink-0" aria-hidden />}
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
            className={`flex-1 min-w-0 bg-transparent outline-none placeholder:text-text-3 ${size === "lg" ? "text-base" : "text-sm"}`}
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
              {items.map((it, i) => (
                <li
                  key={it.key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={it.run}
                  onMouseEnter={() => setActive(i)}
                  className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer ${i === active ? "bg-white/[0.06]" : ""}`}
                >
                  <span className="text-text-3">{it.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{it.label}</span>
                    {it.sub && <span className="block truncate text-[12px] text-text-3 capitalize-first">{it.sub}</span>}
                  </span>
                  {it.demo && <DemoBadge />}
                </li>
              ))}
            </ul>
          )}
          {term.length >= 2 && !loading && data && items.length === 1 && (
            <p className="px-3 pb-2 text-[12px] text-text-3">No matching places, people or venues. Press Enter to search all events.</p>
          )}
          {failed && <p className="px-3 pb-2 text-[12px] text-bad">Suggestions are unavailable right now. Press Enter to search anyway.</p>}
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
