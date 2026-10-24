"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { LayoutGrid, List, SlidersHorizontal, X, Loader2, Map as MapIcon } from "lucide-react";
import { rememberSearch } from "@/lib/search/session";
import { hasWhereOrWhen } from "@/lib/search/summary";
import type { EventCard, Paged, SearchFilters } from "@/lib/types";
import { filtersToParams, activeFilterCount } from "@/lib/search/params";
import { GROUPS } from "@/lib/categories";
import { EventRow, EventTile } from "./event-card";
import { EmptyState, ShapeGlyph } from "./ui";
import { FilterForm, ActiveFilters } from "./discover/filters";

/**
 * Filter state lives in the URL. Every change navigates, the server re-renders
 * results, and the URL is always shareable and crawlable.
 */
export function EventsBrowser({
  result, filters, facets, hideCategoryStrip = false, basePath,
}: {
  result: Paged<EventCard>;
  filters: SearchFilters;
  facets?: { groups: Record<string, number> };
  hideCategoryStrip?: boolean;
  basePath?: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [drawer, setDrawer] = useState(false);

  const go = (f: SearchFilters) => {
    const p = filtersToParams(f);
    start(() => router.push(`${basePath ?? path}${p.toString() ? `?${p}` : ""}`, { scroll: false }));
  };
  const n = activeFilterCount(filters);
  // Keep the shared search in step so other pages can offer to continue it.
  // An empty search here never overwrites a richer one from another page.
  useEffect(() => {
    if (hasWhereOrWhen(filters)) rememberSearch(filters);
  }, [filters]);

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block" aria-label="Filters">
        <div className="sticky top-[calc(var(--header-h)+1rem)] max-h-[calc(100dvh-var(--header-h)-2rem)] overflow-auto scroll-thin pr-2">
          <FilterForm f={filters} onChange={go} showCategories={!hideCategoryStrip} />
        </div>
      </aside>

      <div className="min-w-0">
        {!hideCategoryStrip && (
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-3 -mx-1 px-1" role="group" aria-label="Quick categories">
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
          <Link href={`/?${filtersToParams({ ...filters, page: undefined, pageSize: undefined, sort: undefined })}`} className="btn btn-secondary btn-sm">
            <MapIcon size={14} aria-hidden /> Show on map
          </Link>
          <button className="btn btn-secondary btn-sm lg:hidden" onClick={() => setDrawer(true)}>
            <SlidersHorizontal size={14} aria-hidden /> Filters{n ? <span className="text-cyan tnum">{n}</span> : null}
          </button>
          <label className="sr-only" htmlFor="sort">Sort by</label>
          <select id="sort" className="field !h-[1.875rem] !w-auto !text-[13px]" value={filters.sort ?? (filters.q ? "relevance" : "date")} onChange={(e) => go({ ...filters, sort: e.target.value as SearchFilters["sort"], page: undefined })}>
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
          </div>
        </div>

        <div className="py-3">
          <ActiveFilters f={filters} onChange={go} />
        </div>

        <div className={pending ? "opacity-60 transition-opacity" : ""}>
          {result.items.length === 0 ? (
            <EmptyState
              title="No events match"
              body={<>Try removing a filter or widening the dates. Our sources don&apos;t cover every event on Earth, so a missing result doesn&apos;t mean nothing is on.</>}
              action={n > 0 ? <button className="btn btn-secondary btn-sm" onClick={() => go({ q: filters.q })}>Clear filters</button> : <Link className="btn btn-secondary btn-sm" href="/">Explore the globe</Link>}
            />
          ) : layout === "list" ? (
            <ul className="divide-y divide-line">
              {result.items.map((c) => (
                <EventRow key={c.id} c={c} />
              ))}
            </ul>
          ) : (
            <ul className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              {result.items.map((c) => (
                <EventTile key={c.id} c={c} />
              ))}
            </ul>
          )}
        </div>

        {result.pages > 1 && (
          <nav className="flex items-center justify-between gap-2 mt-6 border-t border-line pt-4" aria-label="Pagination">
            <button className="btn btn-secondary btn-sm" disabled={result.page <= 1} onClick={() => go({ ...filters, page: result.page - 1 })}>
              Previous
            </button>
            <span className="t-small text-text-2 tnum">
              Page {result.page} of {result.pages}
            </span>
            <button className="btn btn-secondary btn-sm" disabled={result.page >= result.pages} onClick={() => go({ ...filters, page: result.page + 1 })}>
              Next
            </button>
          </nav>
        )}
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <button className="absolute inset-0 bg-text/40" aria-label="Close filters" onClick={() => setDrawer(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] flex flex-col bg-panel rounded-t-[var(--radius-l)] border-t border-line-strong panel-in">
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <p className="t-h3">Filters</p>
              <button className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={() => setDrawer(false)}>
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="overflow-auto p-4 flex-1">
              <FilterForm f={filters} onChange={go} showCategories={!hideCategoryStrip} />
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
