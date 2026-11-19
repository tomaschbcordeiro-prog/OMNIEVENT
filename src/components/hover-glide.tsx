"use client";

import { useEffect } from "react";

/*
 * On a computer, one soft shaded area follows the mouse along a list: it appears under the row
 * the pointer is on and glides to the next one as the pointer moves, instead of each row lighting
 * up on its own. Lists opt in with `data-glide` (each direct child is a row) and rows anywhere
 * with `data-glide-item` (drawn in their list). The shade is the list's own ::before, placed with
 * CSS variables, so nothing is added to the page's markup. On a touch screen the same shade shows
 * under the row being pressed, and goes when the finger lifts or starts to scroll.
 */

const SNAP = "data-glide-snap";
const ON = "data-glide-on";
const PRESS = "data-glide-press";
const SKIP = "[aria-disabled='true'], :disabled, [data-glide-skip]";

function rowOf(t: Element): { box: HTMLElement; item: HTMLElement } | null {
  const item = t.closest<HTMLElement>("[data-glide-item]");
  if (item) {
    const box = item.parentElement?.closest<HTMLElement>("[data-glide]") ?? item.parentElement;
    return box ? { box, item } : null;
  }
  const box = t.closest<HTMLElement>("[data-glide]");
  if (!box) return null;
  let el: Element | null = t;
  while (el && el.parentElement !== box) el = el.parentElement;
  return el && el !== box ? { box, item: el as HTMLElement } : null;
}

function place(box: HTMLElement, item: HTMLElement) {
  if (getComputedStyle(box).position === "static") box.style.position = "relative";
  const b = box.getBoundingClientRect();
  const r = item.getBoundingClientRect();
  const x = r.left - b.left - box.clientLeft + box.scrollLeft;
  const y = r.top - b.top - box.clientTop + box.scrollTop;
  const s = box.style;
  s.setProperty("--gx", `${Math.round(x)}px`);
  s.setProperty("--gy", `${Math.round(y)}px`);
  s.setProperty("--gw", `${Math.round(r.width)}px`);
  s.setProperty("--gh", `${Math.round(r.height)}px`);
}

export function HoverGlide() {
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    let box: HTMLElement | null = null;
    let item: HTMLElement | null = null;
    let frame = 0;

    const off = () => {
      box?.removeAttribute(ON);
      box = null;
      item = null;
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !fine.matches) return;
      const hit = rowOf(e.target as Element);
      if (!hit || hit.item.matches(SKIP)) {
        // In the gap between two rows it stays where it is; anywhere else it goes.
        if (box && !box.contains(e.target as Node)) off();
        return;
      }
      if (hit.box === box && hit.item === item) return;
      const fresh = hit.box !== box;
      if (fresh) {
        off();
        // The first row it lands on: it appears there, without sliding in from the last place.
        hit.box.setAttribute(SNAP, "");
      }
      box = hit.box;
      item = hit.item;
      place(box, item);
      box.setAttribute(ON, "");
      if (fresh) {
        const b = box;
        requestAnimationFrame(() => requestAnimationFrame(() => b.removeAttribute(SNAP)));
      }
    };
    // A row that moved under a still pointer (a list growing, a sheet resizing): the shade follows.
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !box || !item || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (box && item && item.isConnected) place(box, item);
        else off();
      });
    };
    const out = (e: PointerEvent) => {
      if (!box) return;
      const to = e.relatedTarget as Node | null;
      if (!to || !box.contains(to)) off();
    };
    document.addEventListener("pointerover", over, { passive: true });
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerout", out, { passive: true });
    // Touch: the row under the finger darkens while it's pressed.
    let pressed: HTMLElement | null = null;
    let px = 0;
    let py = 0;
    let later = 0;
    const unpress = (now: boolean) => {
      const b = pressed;
      if (!b) return;
      pressed = null;
      const go = () => {
        if (b === box) return;
        b.removeAttribute(ON);
        b.removeAttribute(PRESS);
      };
      if (now) go();
      else later = window.setTimeout(go, 160);
    };
    const press = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      const hit = rowOf(e.target as Element);
      if (!hit || hit.item.matches(SKIP)) return;
      window.clearTimeout(later);
      unpress(true);
      pressed = hit.box;
      px = e.clientX;
      py = e.clientY;
      hit.box.setAttribute(SNAP, "");
      place(hit.box, hit.item);
      hit.box.setAttribute(PRESS, "");
      hit.box.setAttribute(ON, "");
      const b = hit.box;
      requestAnimationFrame(() => requestAnimationFrame(() => b.removeAttribute(SNAP)));
    };
    const slide = (e: PointerEvent) => {
      if (pressed && e.pointerType !== "mouse" && Math.hypot(e.clientX - px, e.clientY - py) > 10) unpress(true);
    };
    const lift = (e: PointerEvent) => e.pointerType !== "mouse" && unpress(false);
    document.addEventListener("pointerdown", press, { passive: true });
    document.addEventListener("pointermove", slide, { passive: true });
    document.addEventListener("pointerup", lift, { passive: true });
    document.addEventListener("pointercancel", lift, { passive: true });
    window.addEventListener("blur", off);
    return () => {
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("pointermove", slide);
      document.removeEventListener("pointerup", lift);
      document.removeEventListener("pointercancel", lift);
      window.clearTimeout(later);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerout", out);
      window.removeEventListener("blur", off);
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
