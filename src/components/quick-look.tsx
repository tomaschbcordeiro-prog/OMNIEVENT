"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, ChevronDown, ChevronUp, MapPin, Navigation, Share2, Ticket, X } from "lucide-react";
import type { EventCard } from "@/lib/types";
import { cardWhen, formatDistance } from "@/lib/format";
import { useUserSelect } from "@/lib/user/store";
import { snapOf } from "@/lib/after-event";
import { CategoryIcon, categoryLabel, Poster, Price, SaveButton } from "./ui";
import { TripButton } from "./trips/trip-add";
import { toast } from "./toast";

/*
 * Quick Look: a look at an event without leaving the list, the way a phone peeks at a link and a
 * Mac's Finder shows a file. On a phone, hold an event for a moment; on a computer, point at one
 * (or tab to it) and press the space bar. A card comes up with the picture, when, where and the
 * price, and the things you'd do next: open it, save it, put it in a trip, get directions, share.
 * With the card open, the arrow keys go to the next or previous event in the list, Enter opens
 * it, and Esc or the space bar closes it.
 */

/** The event each row on screen is showing (rows register themselves). */
const cards = new WeakMap<Element, EventCard>();
export function registerQuickLook(el: Element | null, c: EventCard) {
  if (el) cards.set(el, c);
}
let opener: ((c: EventCard, from: Element | null) => void) | null = null;
/** Opens Quick Look for an event; `from` is the row it was opened from (for the arrow keys). */
export function quickLook(c: EventCard, from: Element | null = null) {
  opener?.(c, from);
}

const HOLD_MS = 430;

/**
 * Touch handlers for "hold to look": a finger that stays put for a moment opens Quick Look; one
 * that moves is scrolling or swiping, and is left alone. The tap that ends a hold doesn't open the
 * event, and the phone's own long-press menu for the link doesn't come up.
 */
export function useHoldToLook(c: EventCard) {
  const st = useRef({ timer: 0, x: 0, y: 0, fired: false });
  const cancel = () => window.clearTimeout(st.current.timer);
  return {
    held: () => st.current.fired,
    start: (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1) return;
      const row = e.currentTarget as Element;
      // Not when the finger is on a button of the row (save, trip): those have their own job.
      if ((e.target as Element).closest("button")) return;
      st.current.fired = false;
      st.current.x = t.clientX;
      st.current.y = t.clientY;
      cancel();
      st.current.timer = window.setTimeout(() => {
        st.current.fired = true;
        navigator.vibrate?.(10);
        quickLook(c, row);
      }, HOLD_MS);
    },
    move: (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (t && Math.hypot(t.clientX - st.current.x, t.clientY - st.current.y) > 10) cancel();
    },
    end: cancel,
    contextMenu: (e: React.MouseEvent) => {
      if (st.current.fired) e.preventDefault();
    },
    clickCapture: (e: React.MouseEvent) => {
      if (!st.current.fired) return;
      st.current.fired = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}

function rowsOnScreen(): Element[] {
  return [...document.querySelectorAll("[data-ql]")].filter((el) => cards.has(el) && (el as HTMLElement).offsetParent !== null);
}

export function QuickLookHost() {
  const [state, setState] = useState<{ c: EventCard; from: Element | null } | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const restore = useRef<Element | null>(null);

  useEffect(() => {
    opener = (c, from) => {
      restore.current = document.activeElement;
      setState({ c, from });
    };
    return () => {
      opener = null;
    };
  }, []);

  const current = useRef(state);
  current.current = state;

  const close = useCallback(() => {
    const s = current.current;
    setState(null);
    // Back to where you were: the row it was opened from (or whatever had focus).
    const back = (s?.from?.querySelector("a[href], button") as HTMLElement | null) ?? (restore.current as HTMLElement | null);
    window.setTimeout(() => back?.focus?.({ preventScroll: true }), 0);
  }, []);

  /** The next or previous event in the list it was opened from. */
  const step = useCallback((dir: 1 | -1) => {
    const s = current.current;
    if (!s?.from) return;
    const rows = rowsOnScreen();
    const next = rows[rows.indexOf(s.from) + dir];
    const c = next && cards.get(next);
    if (!next || !c) return;
    next.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setState({ c, from: next });
  }, []);

  // The space bar on a row the pointer is on, or one in focus.
  useEffect(() => {
    let hovered: Element | null = null;
    const over = (e: PointerEvent) => {
      if (e.pointerType === "mouse") hovered = (e.target as Element).closest?.("[data-ql]") ?? null;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== " " || e.metaKey || e.ctrlKey || e.altKey || e.repeat || state) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      // A button in focus does its own thing with the space bar.
      if (active?.matches("button, [role=button], summary")) return;
      const row = active?.closest("[data-ql]") ?? hovered;
      const c = row && cards.get(row);
      if (!row || !c) return;
      e.preventDefault();
      restore.current = active;
      setState({ c, from: row });
    };
    document.addEventListener("pointerover", over, { passive: true });
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("keydown", key);
    };
  }, [state]);

  // While it's open: keys, the page behind holds still, focus stays inside.
  useEffect(() => {
    if (!state) return;
    const root = document.documentElement;
    root.setAttribute("data-quick-look", "");
    dialog.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.key === " " && !(e.target as Element).closest("button, a, input, textarea"))) {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "Enter" && e.target === dialog.current) {
        e.preventDefault();
        dialog.current?.querySelector<HTMLAnchorElement>("a.ql-open")?.click();
      } else if (e.key === "Tab" && dialog.current) {
        const f = [...dialog.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)")];
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      root.removeAttribute("data-quick-look");
      document.removeEventListener("keydown", key);
    };
  }, [state, close, step]);

  if (!state) return null;
  return <Card c={state.c} dialogRef={dialog} onClose={close} onStep={step} canStep={!!state.from} />;
}

function Card({ c, dialogRef, onClose, onStep, canStep }: { c: EventCard; dialogRef: React.RefObject<HTMLElement | null>; onClose: () => void; onStep: (d: 1 | -1) => void; canStep: boolean }) {
  const currency = useUserSelect((d) => d.prefs.currency);
  const people = c.people.slice(0, 3).map((p) => p.name).join(", ");
  const href = `/events/${c.slug}`;
  const share = async () => {
    const url = new URL(href, window.location.origin).toString();
    try {
      if (navigator.share) await navigator.share({ title: c.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast({ title: "Link copied", body: c.title, emoji: "🔗" });
      }
    } catch {
      // closed the share sheet
    }
  };
  return (
    <div className="ql-backdrop" onClick={onClose}>
      <section
        ref={dialogRef}
        key={c.id}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ql-title"
        aria-describedby="ql-when"
        tabIndex={-1}
        className="ql-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ql-media">
          <Poster title={c.title} imageUrl={c.imageUrl} hue={c.posterHue} categorySlug={c.categorySlug} size="lg" priority className="h-full w-full" />
          <button type="button" className="ql-close" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="ql-body">
          <p className="flex items-center gap-1.5 t-micro text-text-2">
            <CategoryIcon slug={c.categorySlug} size={13} />
            <span className="truncate">{c.sports?.competition ?? categoryLabel(c.categorySlug)}</span>
          </p>
          <h2 id="ql-title" className="t-h2 mt-1 text-balance">{c.title}</h2>
          {people && people !== c.title && <p className="t-small text-text-2 mt-0.5 truncate">{people}</p>}
          <dl className="mt-3 grid gap-2 t-small">
            <div className="flex gap-2.5">
              <dt className="sr-only">When</dt>
              <CalendarDays size={16} aria-hidden className="mt-0.5 shrink-0 text-text-3" />
              <dd id="ql-when" className="tnum">{cardWhen(c)}</dd>
            </div>
            <div className="flex gap-2.5">
              <dt className="sr-only">Where</dt>
              <MapPin size={16} aria-hidden className="mt-0.5 shrink-0 text-text-3" />
              <dd>
                {c.venueName}
                <span className="text-text-2">, {c.city}{c.country ? `, ${c.country}` : ""}</span>
                {c.distanceKm != null && <span className="text-text-3"> · {formatDistance(c.distanceKm)} away</span>}
              </dd>
            </div>
            <div className="flex gap-2.5">
              <dt className="sr-only">Price</dt>
              <Ticket size={16} aria-hidden className="mt-0.5 shrink-0 text-text-3" />
              <dd>
                <Price amount={c.fromPrice?.amount} currency={c.fromPrice?.currency} feesIncluded={c.fromPrice?.feesIncluded} isFree={c.isFree} displayCurrency={currency} className="t-small" />
              </dd>
            </div>
          </dl>
          <div className="ql-actions">
            <Link href={href} className="btn btn-primary ql-open press" onClick={onClose}>
              Open event <ArrowRight size={16} aria-hidden className="max-[379px]:hidden" />
            </Link>
            <SaveButton id={c.id} title={c.title} compact snap={snapOf(c)} className="btn-secondary !h-11 !w-11" />
            {!c.online && <TripButton card={c} title={c.title} className="btn-secondary !h-11 !w-11" />}
            {!c.online && Number.isFinite(c.lat) && (
              <a className="btn btn-secondary btn-icon !h-11 !w-11 press" href={`https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`} target="_blank" rel="noopener noreferrer" aria-label={`Directions to ${c.venueName}`} title="Directions">
                <Navigation size={17} aria-hidden />
              </a>
            )}
            <button type="button" className="btn btn-secondary btn-icon !h-11 !w-11 press" aria-label="Share" title="Share" onClick={() => void share()}>
              <Share2 size={17} aria-hidden />
            </button>
          </div>
          {canStep && (
            <div className="ql-foot">
              <span className="max-sm:hidden"><kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> next and previous · <kbd className="kbd">Enter</kbd> opens · <kbd className="kbd">Esc</kbd> closes</span>
              <span className="sm:hidden">Tap outside to close</span>
              <span className="ml-auto flex gap-1">
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Previous event" onClick={() => onStep(-1)}>
                  <ChevronUp size={16} aria-hidden />
                </button>
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Next event" onClick={() => onStep(1)}>
                  <ChevronDown size={16} aria-hidden />
                </button>
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
