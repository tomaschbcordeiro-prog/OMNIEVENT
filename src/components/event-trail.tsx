"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { neighbours, readTrail, slugsOf, writeTrail, type Trail } from "@/lib/trail";

/**
 * Remembers the list an event is opened from: following an event link inside a list (any
 * <ul>, or an element marked data-trail) keeps that list's events for the tab.
 */
export function TrailRecorder() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self")) return;
      const href = a.getAttribute("href");
      if (!slugsOf([href]).length) return;
      // Already on an event page: its own strips (more dates, nearby) start a new list.
      const list = a.closest("[data-trail]") ?? a.closest("ul, ol");
      const slugs = list ? slugsOf([...list.querySelectorAll("a[href^='/events/']")].map((x) => x.getAttribute("href"))) : [];
      writeTrail(slugs.length > 1 ? { back: location.pathname + location.search, slugs, pending: true } : null);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

/**
 * On an event page opened from a list: where it is in that list, the previous and next
 * events one tap (or ← →) away, and the way back to the list.
 */
export function TrailPager({ slug }: { slug: string }) {
  const router = useRouter();
  const [trail, setTrail] = useState<Trail | null>(null);

  useEffect(() => {
    const t = readTrail();
    if (!t || !neighbours(t, slug)) return setTrail(null);
    // How this page was reached decides whether the list is right behind it in history.
    const next: Trail = { ...t, behind: t.pending ? true : t.flip ? !!t.behind : false, pending: false, flip: false };
    writeTrail(next);
    setTrail(next);
  }, [slug]);

  const at = neighbours(trail, slug);

  const go = (to: string | undefined) => {
    if (!to || !trail) return;
    writeTrail({ ...trail, flip: true });
    // Stepping through the list replaces this page, so Back still returns to the list.
    router.replace(`/events/${encodeURIComponent(to)}`);
  };

  // The neighbours load ahead, so stepping is instant.
  useEffect(() => {
    if (!at) return;
    for (const s of [at.next, at.prev]) if (s) router.prefetch(`/events/${encodeURIComponent(s)}`, { kind: PrefetchKind.FULL });
  }, [at?.next, at?.prev, router]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || typing(e.target)) return;
      if (document.querySelector("[role=dialog][aria-modal=true]")) return;
      if (e.key === "ArrowRight" && at.next) {
        e.preventDefault();
        go(at.next);
      } else if (e.key === "ArrowLeft" && at.prev) {
        e.preventDefault();
        go(at.prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!at || !trail) return null;
  return (
    <nav className="trail-pager" aria-label="This event's list">
      {trail.behind ? (
        <button type="button" className="trail-back" onClick={() => router.back()}>
          <ArrowLeft size={15} aria-hidden /> Back to the list
        </button>
      ) : (
        <Link href={trail.back} className="trail-back">
          <ArrowLeft size={15} aria-hidden /> Back to the list
        </Link>
      )}
      <span className="trail-steps">
        <button type="button" className="trail-step" onClick={() => go(at.prev)} disabled={!at.prev} aria-label="Previous event in the list" title="Previous (←)">
          <ChevronLeft size={18} aria-hidden />
        </button>
        <span className="t-small text-text-2 tnum" aria-live="polite">
          {at.index + 1} <span className="text-text-3">of {at.total}</span>
        </span>
        <button type="button" className="trail-step" onClick={() => go(at.next)} disabled={!at.next} aria-label="Next event in the list" title="Next (→)">
          <ChevronRight size={18} aria-hidden />
        </button>
      </span>
    </nav>
  );
}
