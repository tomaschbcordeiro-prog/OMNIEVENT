"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { linkAhead } from "@/lib/prefetch";

/** How long the pointer rests on a link before it counts as "about to click" (a pass across a list doesn't). */
const REST_MS = 80;
/** How long a finger rests on a link before it counts as a tap rather than the start of a scroll. */
const TAP_MS = 60;
/** A page loaded ahead stays usable this long (the router keeps it five minutes). */
const KEEP_MS = 4 * 60_000;
/** At most this many pages ahead a minute, however busy the pointer. */
const PER_MINUTE = 30;

/**
 * Instant pages: when the pointer rests on a link to one of the site's pages, or a finger
 * taps it, the whole page starts loading then, so it's ready (or nearly) when the click
 * lands, typically 100–300 ms later. Not on data-saver or very slow connections.
 */
export function IntentPrefetch() {
  const router = useRouter();

  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? "")) return;
    const loaded = new Map<string, number>();
    let window0 = Date.now();
    let count = 0;
    let timer: number | undefined;
    let over: HTMLAnchorElement | null = null;

    const ahead = (a: HTMLAnchorElement) => {
      const href = linkAhead(a, location.href, location.origin);
      if (!href) return;
      const now = Date.now();
      if (now - (loaded.get(href) ?? -Infinity) < KEEP_MS) return;
      if (now - window0 > 60_000) {
        window0 = now;
        count = 0;
      }
      if (count >= PER_MINUTE) return;
      count++;
      loaded.set(href, now);
      router.prefetch(href, { kind: PrefetchKind.FULL });
    };
    const anchor = (t: EventTarget | null) => ((t as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null) ?? null;

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const a = anchor(e.target);
      if (a === over) return;
      over = a;
      window.clearTimeout(timer);
      if (a) timer = window.setTimeout(() => ahead(a), REST_MS);
    };
    // A finger on a link: a tap, unless it starts moving (a scroll), so wait a moment for that.
    let touchTimer: number | undefined;
    let touched: HTMLAnchorElement | null = null;
    const onTouch = (e: TouchEvent) => {
      window.clearTimeout(touchTimer);
      touched = e.touches.length === 1 ? anchor(e.target) : null;
      if (touched) {
        const a = touched;
        touchTimer = window.setTimeout(() => ahead(a), TAP_MS);
      }
    };
    const onMove = () => {
      window.clearTimeout(touchTimer);
      touched = null;
    };
    const onLift = () => {
      // Lifted before the moment was up: it was a tap.
      if (touched) {
        window.clearTimeout(touchTimer);
        ahead(touched);
        touched = null;
      }
    };
    const onFocus = (e: FocusEvent) => {
      const a = anchor(e.target);
      window.clearTimeout(timer);
      if (a) timer = window.setTimeout(() => ahead(a), REST_MS * 2);
    };
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("touchstart", onTouch, { passive: true, capture: true });
    document.addEventListener("touchmove", onMove, { passive: true, capture: true });
    document.addEventListener("touchend", onLift, { passive: true, capture: true });
    document.addEventListener("focusin", onFocus);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(touchTimer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("touchmove", onMove, { capture: true });
      document.removeEventListener("touchend", onLift, { capture: true });
      document.removeEventListener("touchstart", onTouch, { capture: true });
      document.removeEventListener("focusin", onFocus);
    };
  }, [router]);

  return null;
}
