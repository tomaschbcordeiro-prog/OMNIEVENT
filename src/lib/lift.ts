/*
 * Picking things up and moving them, the same way everywhere on a trip:
 *
 * - On a touch screen, hold a moment and it lifts (a short buzz where the phone can): a quick
 *   swipe is still a scroll, a tap still a tap. A grip lifts at once.
 * - With a mouse, press and move a few pixels.
 * - While it's up, the page doesn't scroll under the finger; near the top or bottom of the
 *   scrolling panel, the panel scrolls by itself. The tap that ends a drag isn't a click.
 *
 * `listReorder` builds on it for a list (or a row) of things: the one picked up follows the
 * pointer, the others slide out of its way as it passes them (with a tick each time), and when
 * it's let go it glides into its new place.
 */

export interface LiftPoint {
  x: number;
  y: number;
}
export interface LiftHandlers {
  lift: (p: LiftPoint) => void;
  move: (p: LiftPoint) => void;
  drop: (p: LiftPoint) => void;
  cancel: () => void;
}
export interface LiftOptions {
  /** Touch: how long to hold before it lifts. */
  hold?: number;
  /** Mouse: how far to move before it lifts. */
  slop?: number;
  /** A grip: lifts at once on touch too (it has touch-action: none). */
  instant?: boolean;
  /** What scrolls while dragging near its edges. */
  scroller?: HTMLElement | null;
}

/** Fields, buttons that do something else and links where a drag shouldn't start. */
const NOT_HERE = "input, textarea, select, [contenteditable], [data-no-lift]";

let busy = false;

export function buzz(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // no vibration here
  }
}

/** Call from onPointerDown. Returns false when this press can't start a drag. */
export function startLift(e: React.PointerEvent<HTMLElement> | PointerEvent, h: LiftHandlers, o: LiftOptions = {}): boolean {
  const target = (e.currentTarget ?? e.target) as HTMLElement;
  if (busy || (e.pointerType === "mouse" && e.button !== 0)) return false;
  if ((e.target as Element).closest(NOT_HERE)) return false;
  const id = e.pointerId;
  const touch = e.pointerType !== "mouse";
  const x0 = e.clientX;
  const y0 = e.clientY;
  let x = x0;
  let y = y0;
  let up = false;
  let timer = 0;
  let frame = 0;
  let rolling = 0;
  busy = true;

  const noScroll = (ev: TouchEvent) => {
    if (up && ev.cancelable) ev.preventDefault();
  };
  const noMenu = (ev: Event) => ev.preventDefault();
  const noClick = (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  const roll = () => {
    const box = o.scroller;
    if (!box || !up) return;
    const r = box.getBoundingClientRect();
    const edge = Math.min(72, r.height / 4);
    const v = y < r.top + edge ? -Math.ceil((r.top + edge - y) / 5) : y > r.bottom - edge ? Math.ceil((y - (r.bottom - edge)) / 5) : 0;
    if (v) {
      const before = box.scrollTop;
      box.scrollTop += v;
      if (box.scrollTop !== before) h.move({ x, y });
    }
    rolling = requestAnimationFrame(roll);
  };
  const lift = () => {
    if (up) return;
    up = true;
    target.removeAttribute("data-pressing");
    try {
      target.setPointerCapture(id);
    } catch {
      // the pointer is gone already
    }
    if (touch) buzz(12);
    document.documentElement.setAttribute("data-lifting", "");
    h.lift({ x, y });
    rolling = requestAnimationFrame(roll);
  };
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    x = ev.clientX;
    y = ev.clientY;
    if (!up) {
      const far = Math.hypot(x - x0, y - y0);
      // A finger that moves before the hold is up is scrolling or swiping: let it.
      if (touch && !o.instant) {
        if (far > 10) finish(false);
      } else if (far > (o.slop ?? 5)) lift();
      return;
    }
    if (ev.cancelable) ev.preventDefault();
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        h.move({ x, y });
      });
  };
  const upHandler = (ev: PointerEvent) => ev.pointerId === id && finish(true);
  const cancelHandler = (ev: PointerEvent) => ev.pointerId === id && finish(false);
  const blur = () => finish(false);
  function finish(ok: boolean) {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    cancelAnimationFrame(rolling);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", upHandler);
    window.removeEventListener("pointercancel", cancelHandler);
    window.removeEventListener("blur", blur);
    document.removeEventListener("touchmove", noScroll);
    document.removeEventListener("contextmenu", noMenu, true);
    document.documentElement.removeAttribute("data-lifting");
    target.removeAttribute("data-pressing");
    busy = false;
    if (!up) return;
    window.addEventListener("click", noClick, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", noClick, true), 60);
    if (ok) h.drop({ x, y });
    else h.cancel();
  }
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", upHandler);
  window.addEventListener("pointercancel", cancelHandler);
  window.addEventListener("blur", blur);
  document.addEventListener("touchmove", noScroll, { passive: false });
  if (touch) document.addEventListener("contextmenu", noMenu, true);
  if (touch && o.instant) lift();
  else if (touch) {
    // While the finger holds, the thing sinks a little: it's about to come up.
    target.setAttribute("data-pressing", "");
    timer = window.setTimeout(lift, o.hold ?? 190);
  }
  return true;
}

/**
 * Reordering the children of a list (vertical) or a row (horizontal): returns the handlers for
 * `startLift`. `drop` gets the new index (the same one when nothing moved).
 */
export function listReorder({ box, from, axis = "y", onDrop, onTarget }: { box: HTMLElement; from: number; axis?: "x" | "y"; onDrop: (to: number) => void; onTarget?: (to: number) => void }): LiftHandlers {
  const items = () => [...box.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !c.hasAttribute("data-lift-skip"));
  let start: LiftPoint = { x: 0, y: 0 };
  let rects: DOMRect[] = [];
  let to = from;
  let scroll0 = 0;
  /** How far the list's own change on lifting (folded details) moved it from under the pointer. */
  let shift = 0;
  const scroller = () => box.closest<HTMLElement>("[data-lift-scroll]");
  const pos = (r: DOMRect) => (axis === "y" ? r.top : r.left);
  const size = (r: DOMRect) => (axis === "y" ? r.height : r.width);
  const clear = (animate: boolean) => {
    for (const el of items()) {
      if (!animate) el.style.transition = "none";
      el.style.transform = "";
      el.removeAttribute("data-lifted");
      if (!animate) requestAnimationFrame(() => (el.style.transition = ""));
    }
    box.removeAttribute("data-reordering");
  };
  return {
    lift: (p) => {
      start = p;
      scroll0 = scroller()?.scrollTop ?? 0;
      const pre = items()[from]?.getBoundingClientRect();
      box.setAttribute("data-reordering", "");
      const els = items();
      rects = els.map((el) => el.getBoundingClientRect());
      shift = pre && rects[from] ? pos(pre) - pos(rects[from]) : 0;
      els[from]?.setAttribute("data-lifted", "");
      if (els[from]) els[from].style.transform = axis === "y" ? `translate3d(0, ${shift}px, 0)` : `translate3d(${shift}px, 0, 0)`;
    },
    move: (p) => {
      const els = items();
      const el = els[from];
      if (!el) return;
      const scrolled = (scroller()?.scrollTop ?? 0) - scroll0;
      const d = (axis === "y" ? p.y - start.y : p.x - start.x) + (axis === "y" ? scrolled : 0) + shift;
      const me = rects[from];
      const centre = pos(me) + size(me) / 2 + d;
      // Where it would go: past the middle of a neighbour, it takes that neighbour's place.
      let next = from;
      rects.forEach((r, j) => {
        const mid = pos(r) + size(r) / 2;
        if (j < from && centre < mid) next = Math.min(next, j);
        if (j > from && centre > mid) next = Math.max(next, j);
      });
      if (next !== to) {
        to = next;
        buzz(4);
        onTarget?.(to);
      }
      // The gap it leaves: its own size and the space after it.
      const gap = rects[from + 1] ? pos(rects[from + 1]) - (pos(me) + size(me)) : rects[from - 1] ? pos(me) - (pos(rects[from - 1]) + size(rects[from - 1])) : 0;
      const room = size(me) + Math.max(0, gap);
      const t = (v: number) => (axis === "y" ? `translate3d(0, ${v}px, 0)` : `translate3d(${v}px, 0, 0)`);
      els.forEach((x, j) => {
        if (j === from) x.style.transform = t(d);
        else if (from < to && j > from && j <= to) x.style.transform = t(-room);
        else if (to < from && j >= to && j < from) x.style.transform = t(room);
        else x.style.transform = "";
      });
    },
    drop: () => {
      const el = items()[from];
      const before = el?.getBoundingClientRect();
      clear(false);
      if (to !== from) onDrop(to);
      // It glides from where it was let go into its new place.
      if (el && before) {
        requestAnimationFrame(() => {
          const after = el.getBoundingClientRect();
          const dx = before.left - after.left;
          const dy = before.top - after.top;
          if (!dx && !dy) return;
          el.style.transition = "none";
          el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
          el.setAttribute("data-settling", "");
          void el.offsetWidth;
          el.style.transition = "transform 200ms cubic-bezier(0.2, 0.9, 0.25, 1)";
          el.style.transform = "";
          window.setTimeout(() => {
            el.style.transition = "";
            el.removeAttribute("data-settling");
          }, 220);
        });
      }
    },
    cancel: () => clear(true),
  };
}
