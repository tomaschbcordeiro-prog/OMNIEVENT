"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { History, X } from "lucide-react";
import type { SearchFilters } from "@/lib/types";
import { recallSearch, forgetSearch } from "@/lib/search/session";
import { filtersToParams, parseFilterParams } from "@/lib/search/params";
import { summarizeSearch, hasWhereOrWhen } from "@/lib/search/summary";

/**
 * Offers to carry the search from another page (place, radius, dates, local times,
 * categories) into this one. Nothing is applied without a click.
 * `keep` lists filter keys this page controls itself (e.g. a category page's category).
 */
export function ContinueSearch({ keep = [] }: { keep?: (keyof SearchFilters)[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [prev, setPrev] = useState<SearchFilters | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const p = parseFilterParams(new URLSearchParams(sp.toString()));
    const current = p.ok ? p.filters : {};
    const r = recallSearch();
    if (r) for (const k of keep) delete (r as Record<string, unknown>)[k];
    // Only offer when the previous search had a place or time this page isn't already using.
    if (r && hasWhereOrWhen(r) && !hasWhereOrWhen(current)) setPrev(r);
    else setPrev(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  if (!prev || dismissed) return null;
  const s = summarizeSearch(prev);
  const apply = () => {
    const p = parseFilterParams(new URLSearchParams(sp.toString()));
    const current = p.ok ? p.filters : {};
    const merged: SearchFilters = { ...prev };
    for (const k of keep) (merged as Record<string, unknown>)[k] = current[k];
    if (current.q) merged.q = current.q;
    router.push(`${path}?${filtersToParams(merged)}`, { scroll: false });
  };
  return (
    <div role="region" aria-label="Continue your search" className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-m)] border border-cyan/30 bg-cyan/[0.05] px-3 py-2 t-small panel-in">
      <History size={15} className="text-cyan shrink-0" aria-hidden />
      <span className="flex-1 min-w-0">
        Continue your search: <span className="text-text">{s.text}</span>
      </span>
      <button className="btn btn-primary btn-sm" onClick={apply}>Apply</button>
      <button className="btn btn-ghost btn-icon btn-sm" aria-label="Dismiss" onClick={() => (setDismissed(true), forgetSearch())}>
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
