"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUp, CalendarDays, LayoutGrid, List, SlidersHorizontal, X, Loader2, Map as MapIcon } from "lucide-react";
import { rememberSearch } from "@/lib/search/session";
import { hasWhereOrWhen } from "@/lib/search/summary";
import type { EventCard, Paged, SearchFilters } from "@/lib/types";
import { filtersToParams, activeFilterCount } from "@/lib/search/params";
import { GROUPS } from "@/lib/categories";
import { EventRow, EventTile } from "./event-card";
import { EmptyState, ShapeGlyph } from "./ui";
import { FilterForm, ActiveFilters } from "./discover/filters";
import { QuickWhen } from "./quick-when";
import { CalendarView } from "./calendar-view";

/**
 * Filter state lives in the URL. Every change navigates, the server re-renders
 * results, and the URL is always shareable and crawlable.
 */
/** Small words not worth marking in titles. */
const STOP = new Set(["the", "and", "for", "with", "this", "that", "next", "near", "from", "until", "der", "die", "das", "und", "les", "des", "pour", "avec", "del", "los", "las", "con", "para", "dos", "das", "com", "por", "uma", "um"]);

export function EventsBrowser({
  result, filters, facets, hideCategoryStrip = false, basePath, implicitCity, anywhere = false, suggestion, query,
}: {
  /** The whole search behind `result`, when `filters` leaves out what the page adds (its place). */
  query?: SearchFilters;
  /** For a search that found nothing: the same search with a typo fixed. */
  suggestion?: string;
  result: Paged<EventCard>;
  filters: SearchFilters;
  facets?: { groups: Record<string, number> };
  hideCategoryStrip?: boolean;
  basePath?: string;
  /** The visitor's city, added because the search named no place: dropping it means "everywhere". */
  implicitCity?: string;
  /** The visitor asked for everywhere: keep it so as they refine the search. */
  anywhere?: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  // List or grid, as the visitor last chose.
  const [layout, setLayoutState] = useState<"list" | "grid" | "calendar">("list");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("omnievent:layout");
      if (saved === "grid" || saved === "calendar") setLayoutState(saved);
    } catch {
      // storage unavailable
    }
  }, []);
  const setLayout = (l: "list" | "grid" | "calendar") => {
    setLayoutState(l);
    try {
      localStorage.setItem("omnievent:layout", l);
    } catch {
      // private mode
    }
  };
  const more = useMoreEvents(result, query ?? filters);
  useListKeys();
  const items = more.items;
  // The words searched for, marked in the titles that match.
  const terms = useMemo(() => (filters.q ?? "").split(/[\s,.;:!?"“”()]+/).filter((w) => w.length >= 3 && !STOP.has(w.toLowerCase())), [filters.q]);
  const [drawer, setDrawer] = useState(false);

  const go = (f: SearchFilters) => {
    const p = filtersToParams(f);
    const placed = !!(f.city || f.country || f.continent || f.near || f.places?.length || f.group || f.venue);
    if (!placed && (anywhere || (implicitCity && filters.city === implicitCity))) p.set("where", "any");
    start(() => router.push(`${basePath ?? path}${p.toString() ? `?${p}` : ""}`, { scroll: false }));
  };
  const n = activeFilterCount(filters);
  // The filter sheet closes with Escape, and takes focus when it opens.
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!drawer) return;
    sheet.current?.querySelector<HTMLElement>("button, input, select")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);
  // Keep the shared search in step so other pages can offer to continue it.
  // An empty search here never overwrites a richer one from another page.
  useEffect(() => {
    if (hasWhereOrWhen(filters)) rememberSearch(filters);
  }, [filters]);

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      {/* Desktop sidebar */}
      <section className="hidden lg:block" aria-label="Filters">
        <div className="sticky top-[calc(var(--header-h)+1rem)] max-h-[calc(100dvh-var(--header-h)-2rem)] overflow-auto scroll-thin pr-2">
          <FilterForm f={filters} onChange={go} showCategories={!hideCategoryStrip} counts={facets?.groups} />
        </div>
      </section>

      <div className="min-w-0">
        <QuickWhen f={filters} onChange={go} className="pb-2.5" />
        {!hideCategoryStrip && (
          // On wide screens the filter rail already lists the categories (with counts).
          <div className="flex lg:hidden gap-1.5 overflow-x-auto no-scrollbar pb-3 -mx-1 px-1" role="group" aria-label="Quick categories">
            <button className="chip" aria-pressed={!filters.categories?.length} onClick={() => go({ ...filters, categories: undefined, page: undefined })}>
              All
            </button>
            {GROUPS.filter((g) => g.slug !== "other").map((g) => {
              const on = filters.categories?.length === 1 && filters.categories[0] === g.slug;
              return (
                <button key={g.slug} className="chip" aria-pressed={on} onClick={() => go({ ...filters, categories: on ? undefined : [g.slug], page: undefined })}>
                  <ShapeGlyph group={g.slug} size={9} />
                  {g.name.split(" &")[0]}
                  {facets?.groups[g.slug] != null && !filters.categories?.length && <span className="text-text-3 tnum">{facets.groups[g.slug]}</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
          <p className="t-small text-text-2 tnum mr-auto flex items-center gap-2" aria-live="polite">
            {pending && <Loader2 size={14} className="animate-spin" aria-hidden />}
            {result.total.toLocaleString()} {result.total === 1 ? "event" : "events"}
          </p>
          <Link href={`/?${filtersToParams({ ...filters, page: undefined, pageSize: undefined, sort: undefined })}`} className="btn btn-secondary btn-sm" aria-label="Show on map">
            <MapIcon size={14} aria-hidden /> <span className="max-sm:hidden">Show on map</span>
          </Link>
          <button className="btn btn-secondary btn-sm lg:hidden" onClick={() => setDrawer(true)}>
            <SlidersHorizontal size={14} aria-hidden /> Filters{n ? <span className="text-cyan tnum">{n}</span> : null}
          </button>
          <label className="sr-only" htmlFor="sort">Sort by</label>
          <select id="sort" className="field max-sm:!h-9 max-sm:!text-[14px] lg:!h-[1.875rem] !w-auto lg:!text-[13px]" value={filters.sort ?? (filters.q ? "relevance" : "date")} onChange={(e) => go({ ...filters, sort: e.target.value as SearchFilters["sort"], page: undefined })}>
            <option value="date">Soonest first</option>
            <option value="relevance">Best match</option>
            <option value="price">Lowest price</option>
            <option value="announced">Recently announced</option>
            <option value="distance" disabled={!filters.near}>Nearest{filters.near ? "" : " (pick a location)"}</option>
          </select>
          <div className="flex rounded-[var(--radius-s)] border border-line-strong p-0.5" role="radiogroup" aria-label="Layout">
            <button role="radio" aria-checked={layout === "list"} aria-label="List layout" className={`btn btn-sm btn-icon !h-6 ${layout === "list" ? "bg-text/[0.08]" : "btn-ghost"}`} onClick={() => setLayout("list")}>
              <List size={14} aria-hidden />
            </button>
            <button role="radio" aria-checked={layout === "grid"} aria-label="Grid layout" className={`btn btn-sm btn-icon !h-6 ${layout === "grid" ? "bg-text/[0.08]" : "btn-ghost"}`} onClick={() => setLayout("grid")}>
              <LayoutGrid size={14} aria-hidden />
            </button>
            <button role="radio" aria-checked={layout === "calendar"} aria-label="Calendar: events per day" title="Calendar" className={`btn btn-sm btn-icon !h-6 ${layout === "calendar" ? "bg-text/[0.08]" : "btn-ghost"}`} onClick={() => setLayout("calendar")}>
              <CalendarDays size={14} aria-hidden />
            </button>
          </div>
        </div>

        <div className="py-3">
          <ActiveFilters f={filters} onChange={go} />
        </div>

        <div className={pending ? "opacity-60 transition-opacity" : ""}>
          {layout === "calendar" ? (
            // A day picked on the calendar shows that day's events as a list.
            <CalendarView query={query ?? filters} onPickDay={(day) => (setLayout("list"), go({ ...filters, from: day, to: day, page: undefined }))} />
          ) : items.length === 0 ? (
            <EmptyState
              title="No events match"
              body={
                <>
                  {suggestion && (
                    <span className="block mb-2 text-text">
                      Did you mean{" "}
                      <button type="button" className="font-semibold text-cyan underline underline-offset-4" onClick={() => go({ ...filters, q: suggestion, page: undefined })}>
                        “{suggestion}”
                      </button>
                      ?
                    </span>
                  )}
                  Try removing a filter or widening the dates. Our sources don&apos;t cover every event on Earth, so a missing result doesn&apos;t mean nothing is on.
                </>
              }
              action={n > 0 ? <button className="btn btn-secondary btn-sm" onClick={() => go({ q: filters.q })}>Clear filters</button> : <Link className="btn btn-secondary btn-sm" href="/">Explore the globe</Link>}
            />
          ) : layout === "list" ? (
            <ul className="divide-y divide-line" data-event-list onClickCapture={more.remember}>
              {items.map((c) => (
                <EventRow key={c.id} c={c} terms={terms} />
              ))}
            </ul>
          ) : (
            <ul className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" data-event-list onClickCapture={more.remember}>
              {items.map((c) => (
                <EventTile key={c.id} c={c} terms={terms} />
              ))}
            </ul>
          )}
        </div>

        {result.total > 0 && layout !== "calendar" && (
          <nav className="mt-6 border-t border-line pt-4 grid justify-items-center gap-3" aria-label="More events">
            <p className="t-small text-text-2 tnum" aria-live="polite">
              {more.done ? (result.total > items.length ? `${items.length.toLocaleString()} shown` : `That's all ${result.total.toLocaleString()}`) : `${items.length.toLocaleString()} of ${result.total.toLocaleString()}`}
            </p>
            {!more.done && (
              <>
                {/* Comes into view as the list ends: the next events load by themselves. */}
                <div ref={more.sentinel} aria-hidden className="h-px w-full" />
                <Link
                  href={`${basePath ?? path}?${filtersToParams({ ...filters, page: more.nextPage })}`}
                  className="btn btn-secondary press min-w-48"
                  onClick={(e) => {
                    e.preventDefault();
                    void more.load();
                  }}
                  aria-busy={more.loading}
                >
                  {more.loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
                  {more.loading ? "Loading more" : "Show more events"}
                </Link>
              </>
            )}
            {result.page > 1 && (
              <button className="btn btn-ghost btn-sm" onClick={() => go({ ...filters, page: undefined })}>
                Back to the first events
              </button>
            )}
          </nav>
        )}
        <BackToTop />
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <button className="absolute inset-0 bg-text/40" aria-label="Close filters" onClick={() => setDrawer(false)} />
          <div ref={sheet} className="absolute inset-x-0 bottom-0 max-h-[85dvh] flex flex-col bg-panel rounded-t-[var(--radius-l)] border-t border-line-strong panel-in">
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <p className="t-h3">Filters</p>
              <button className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={() => setDrawer(false)}>
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="overflow-auto p-4 flex-1">
              <FilterForm f={filters} onChange={go} showCategories={!hideCategoryStrip} counts={facets?.groups} />
            </div>
            <div className="p-4 border-t border-line">
              <button className="btn btn-primary w-full" onClick={() => setDrawer(false)}>
                Show {result.total.toLocaleString()} events
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The next events of a list, added below it as the visitor reaches its end (or taps "Show
 * more"), without leaving the page. What was added, and where the visitor was, are kept for
 * this tab: back from an event, the list is as they left it.
 */
// When the visitor last went back or forward in this tab: only then is a list put back as it was.
let lastPop = 0;
if (typeof window !== "undefined") window.addEventListener("popstate", () => (lastPop = Date.now()));

function useMoreEvents(result: Paged<EventCard>, query: SearchFilters) {
  const key = `omnievent:more:${filtersToParams({ ...query, page: result.page })}|${result.total}|${result.items[0]?.id ?? ""}`;
  const [extra, setExtra] = useState<EventCard[]>([]);
  const [page, setPage] = useState(result.page);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const auto = useRef(0);

  // A new search starts from its own first page (or back where this tab left it).
  useEffect(() => {
    setFailed(false);
    auto.current = 0;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as { extra: EventCard[]; page: number; y: number } | null;
      if (saved?.extra?.length && Date.now() - lastPop < 3000) {
        setExtra(saved.extra);
        setPage(saved.page);
        requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: saved.y })));
        return;
      }
    } catch {
      // storage unavailable
    }
    setExtra([]);
    setPage(result.page);
  }, [key, result.page]);

  const done = page >= result.pages || failed;
  const items = useMemo(() => {
    if (!extra.length) return result.items;
    const seen = new Set(result.items.map((c) => c.id));
    return [...result.items, ...extra.filter((c) => !seen.has(c.id) && (seen.add(c.id), true))];
  }, [result.items, extra]);

  const load = async () => {
    if (busy.current || page >= result.pages) return;
    busy.current = true;
    setLoading(true);
    try {
      const p = filtersToParams({ ...query, page: page + 1, pageSize: result.pageSize });
      const r = await fetch(`/api/events?${p}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as Paged<EventCard>;
      setExtra((x) => [...x, ...j.items]);
      setPage(page + 1);
      if (!j.items.length) setFailed(true);
    } catch {
      // Stops loading by itself; the button (a link to that page) still works.
      auto.current = Infinity;
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };
  const loadRef = useRef(load);
  loadRef.current = load;

  // Loads by itself as the end of the list comes near, for a good while; then waits for a tap.
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && auto.current < 8) {
          auto.current++;
          void loadRef.current();
        }
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [sentinel, page]);

  /** Kept when the visitor opens an event from the list, to come back to the same place. */
  const remember = () => {
    try {
      if (extra.length) sessionStorage.setItem(key, JSON.stringify({ extra, page, y: window.scrollY }));
      else sessionStorage.removeItem(key);
    } catch {
      // storage full or unavailable
    }
  };

  return { items, load, loading, done, nextPage: page + 1, sentinel: setSentinel, remember };
}

/** Back to the top of a long list, once the visitor is well down it. */
function BackToTop() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > 1600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!shown) return null;
  return (
    <button
      type="button"
      className="back-to-top btn btn-secondary btn-icon press panel-in"
      aria-label="Back to the top"
      onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
    >
      <ArrowUp size={18} aria-hidden />
    </button>
  );
}

/** j and k move through the events of the list (Enter opens one), as in a mail inbox. */
function useListKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "j" && e.key !== "k") || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      const links = [...document.querySelectorAll<HTMLAnchorElement>("[data-event-list] > li > a")];
      if (!links.length) return;
      e.preventDefault();
      const at = links.indexOf(document.activeElement as HTMLAnchorElement);
      const next = links[at < 0 ? 0 : Math.min(links.length - 1, Math.max(0, at + (e.key === "j" ? 1 : -1)))];
      next.focus();
      next.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
