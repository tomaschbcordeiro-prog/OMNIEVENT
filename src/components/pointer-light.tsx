"use client";

import { useEffect } from "react";

/*
 * Light that follows the pointer, all over the site.
 *
 * - With a mouse, a soft glow trails the pointer across the page, behind the content (it lights
 *   the sky, not the words). Whatever can be clicked under the pointer catches the light: a
 *   spotlight inside its shape, centred on the pointer, and, on anything with an edge, the edge
 *   nearest the pointer lights up. Pressing makes it stronger.
 * - On a touch screen, the thing under the finger lights up from the finger out, the light
 *   follows the finger while it holds, and fades when it lifts or the page starts to scroll.
 *
 * One layer does it: laid over the thing being lit (its shape, its corners, cut to the part of it
 * that shows), with the light a radial gradient placed by CSS variables, so nothing in the page's
 * own markup changes. It's drawn from a requestAnimationFrame loop that only runs for a few frames
 * after the pointer moves, the page scrolls or something is pressed.
 */

/** What can catch the light: links, buttons and the like, and anything marked `data-light`. */
const LIT = [
  "a[href]",
  "button",
  "summary",
  "label[for]",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='menuitemradio']",
  "[role='option']",
  "[role='switch']",
  "[role='checkbox']",
  ".press",
  "[data-light]",
].join(",");
/** Where it never shows: fields, sliders, the maps and anything marked `data-no-light`. */
const NO_LIGHT = "[data-no-light], input, textarea, select, [contenteditable='true'], [role='slider'], .maplibregl-map, canvas, video, iframe";
/** Above the page's content, under its bars and sheets (the header is 40, the action bar 35). */
const PAGE_Z = "29";
const TOP_Z = "2147483000";

interface Lit {
  /** The thing that catches the light. */
  el: HTMLElement;
  /** Whose box the light takes: the thing, or the card inside a plain link around a card. */
  box: HTMLElement;
  /** Its scrolling or clipping ancestors: the light is cut to what shows through them. */
  clips: HTMLElement[];
  /** In a bar, a menu or a sheet: drawn on top of everything. */
  raised: boolean;
  /** Where the layer goes: the page, or the open dialog it's in. */
  home: HTMLElement;
  radius: number;
  tone: "light" | "dark" | "sheen";
  /** How far the lit edge reaches from the pointer: short, so the light comes from one side. */
  reach: number;
  edge: number;
  rounded: string;
  /** How far it reaches past the box on each side (rows in a list whose shade is wider). */
  pad: number;
  /** A bare thing with no corners of its own (a tab, a plain link): the light has soft edges. */
  soft: boolean;
  /** The list, for a row of a list with the gliding shade (which already shades the row). */
  list: HTMLElement | null;
  /** Under a finger, the light gathers closer around it. */
  near: number;
}

/** A row in a list that has the gliding shade (components/hover-glide.tsx), and the list. */
function glideRow(el: HTMLElement): { item: HTMLElement; list: HTMLElement } | null {
  const item = el.closest<HTMLElement>("[data-glide-item]");
  if (item) {
    const list = item.parentElement?.closest<HTMLElement>("[data-glide]") ?? item.parentElement;
    return list ? { item, list } : null;
  }
  const list = el.closest<HTMLElement>("[data-glide]");
  if (!list) return null;
  let a: Element | null = el;
  while (a && a.parentElement !== list) a = a.parentElement;
  return a && a !== list ? { item: a as HTMLElement, list } : null;
}

function px(v: string): number {
  const n = parseFloat(v) || 0;
  return v.trim().endsWith("rem") ? n * parseFloat(getComputedStyle(document.documentElement).fontSize) : n;
}

let ink: CanvasRenderingContext2D | null | undefined;
/** How light a colour is, 0 to 1 (any CSS colour, read through a 1-pixel canvas). */
function lightness(colour: string): number {
  const rgb = colour.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  let r: number, g: number, b: number;
  if (rgb) [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  else {
    if (ink === undefined) ink = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!ink) return 0;
    ink.clearRect(0, 0, 1, 1);
    ink.fillStyle = "#000";
    ink.fillStyle = colour;
    ink.fillRect(0, 0, 1, 1);
    [r, g, b] = ink.getImageData(0, 0, 1, 1).data;
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function find(t: EventTarget | null): HTMLElement | null {
  if (!(t instanceof Element)) return null;
  const el = t.closest<HTMLElement>(LIT);
  if (!el || el.closest(NO_LIGHT) || el.matches(":disabled, [aria-disabled='true']")) return null;
  return el;
}

function describe(el: HTMLElement): Lit | null {
  let box = el;
  let cs = getComputedStyle(el);
  // A plain link wrapped around a card: the light takes the card's shape.
  if (cs.display === "inline" || cs.display === "contents") {
    const only = el.children.length === 1 ? (el.firstElementChild as HTMLElement) : null;
    const os = only ? getComputedStyle(only) : null;
    if (!only || !os || os.display === "inline" || os.display === "contents") return null;
    box = only;
    cs = os;
  }
  if (cs.visibility !== "visible" || Number(cs.opacity) < 0.2) return null;
  // Dark words mean a light surface: it darkens. Light words (night, the main buttons, words on a
  // picture) mean a dark one: it brightens. The main buttons (light words on a painted sweep) get
  // a brighter, whiter sheen.
  const light = lightness(cs.color) > 0.6;
  const tone = light && cs.backgroundImage.includes("gradient") ? "sheen" : light ? "light" : "dark";
  let rounded = cs.borderRadius;
  let edge = parseFloat(cs.borderTopWidth) || 0;
  let pad = 0;
  let soft = false;
  let list: HTMLElement | null = null;
  if (rounded === "0px") {
    // A bare link in a list row: the light takes the row's shape, the same as the row's shade.
    const row = glideRow(box);
    if (row) {
      const ls = getComputedStyle(row.list);
      box = row.item;
      list = row.list;
      cs = getComputedStyle(box);
      rounded = ls.getPropertyValue("--glide-r").trim() || "12px";
      pad = px(ls.getPropertyValue("--glide-px"));
      edge = 0;
    } else soft = true;
  }
  const r = box.getBoundingClientRect();
  // Nothing tiny, and nothing the size of the page (a whole panel that happens to be a link).
  if (r.width < 12 || r.height < 12 || r.width * r.height > window.innerWidth * window.innerHeight * 0.5) return null;
  const clips: HTMLElement[] = [];
  let raised = cs.position === "fixed" || cs.position === "sticky";
  let home: HTMLElement = document.body;
  if (cs.position !== "fixed") {
    for (let a = box.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      if (a instanceof HTMLDialogElement && a.open && a.matches(":modal")) {
        home = a;
        clips.push(a);
        break;
      }
      const s = getComputedStyle(a);
      if (s.overflowX !== "visible" || s.overflowY !== "visible") clips.push(a);
      if (s.position === "fixed") {
        raised = true;
        break;
      }
      if (s.position === "sticky" || (s.position === "absolute" && s.zIndex !== "auto" && Number(s.zIndex) >= 30)) raised = true;
    }
  }
  const long = Math.max(r.width, r.height);
  return {
    el,
    box,
    clips,
    raised,
    home,
    radius: Math.round(Math.min(280, Math.max(80, long * 0.55))),
    near: Math.round(Math.min(170, Math.max(70, long * 0.38))),
    reach: Math.round(Math.min(220, Math.max(40, long * 0.4))),
    tone,
    edge: soft ? 0 : edge,
    rounded,
    pad,
    soft,
    list,
  };
}

export function PointerLight() {
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;

    const layer = document.createElement("div");
    layer.className = "pl";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = '<span class="pl-fill"></span><span class="pl-edge"></span>';
    document.body.append(layer);
    const aura = document.createElement("div");
    aura.className = "pl-aura";
    aura.setAttribute("aria-hidden", "true");
    document.body.append(aura);

    let lit: Lit | null = null;
    /** The last thing under the mouse that can't take the light (asked once, not every frame). */
    let passed: HTMLElement | null = null;
    let on = false;
    let mode: "mouse" | "touch" | null = null;
    let x = 0;
    let y = 0;
    let mouseIn = false;
    let w = -1;
    let h = -1;
    // The page glow, easing after the pointer.
    let ax = 0;
    let ay = 0;
    let auraOn = false;
    // A finger.
    let finger = -1;
    let pressedAt = 0;
    let letGo = 0;
    let forget = 0;
    // The frames still to draw.
    let left = 0;
    let raf = 0;

    const show = (v: boolean) => {
      if (v === on) return;
      on = v;
      if (v) {
        window.clearTimeout(forget);
        layer.setAttribute("data-on", "");
      } else layer.removeAttribute("data-on");
    };
    const take = (next: Lit | null) => {
      lit = next;
      if (!next) return;
      if (next.home !== layer.parentElement) next.home.append(layer);
      const s = layer.style;
      s.zIndex = next.raised || next.home !== document.body ? TOP_Z : PAGE_Z;
      s.borderRadius = next.rounded;
      s.setProperty("--pl-r", `${next.radius}px`);
      s.setProperty("--pl-bw", `${Math.max(1, next.edge)}px`);
      s.setProperty("--pl-reach", `${next.reach}px`);
      layer.setAttribute("data-tone", next.tone);
      if (next.edge >= 1) layer.setAttribute("data-edge", "");
      else layer.removeAttribute("data-edge");
      if (next.soft) layer.setAttribute("data-soft", "");
      else layer.removeAttribute("data-soft");
      if (next.list) layer.setAttribute("data-row", "");
      else layer.removeAttribute("data-row");
    };
    /** Gone at once, without fading over whatever took its place (the next page, say). */
    const vanish = () => {
      if (!layer.isConnected) document.body.append(layer);
      lit = null;
      layer.setAttribute("data-snap", "");
      show(false);
      requestAnimationFrame(() => layer.removeAttribute("data-snap"));
    };
    /** Lays the layer over the lit thing, cut to what shows of it. False when none of it shows. */
    const paint = (): boolean => {
      if (!lit) return false;
      if (!lit.box.isConnected || !layer.isConnected) {
        vanish();
        return false;
      }
      const box = lit.box.getBoundingClientRect();
      const r = lit.pad ? new DOMRect(box.left - lit.pad, box.top, box.width + 2 * lit.pad, box.height) : box;
      let t = r.top;
      let l = r.left;
      let b = r.bottom;
      let rt = r.right;
      for (const c of lit.clips) {
        const q = c.getBoundingClientRect();
        const ct = q.top + c.clientTop;
        const cl = q.left + c.clientLeft;
        t = Math.max(t, ct);
        l = Math.max(l, cl);
        b = Math.min(b, ct + (c.clientHeight || q.height));
        rt = Math.min(rt, cl + (c.clientWidth || q.width));
      }
      if (rt - l < 2 || b - t < 2) return false;
      const s = layer.style;
      s.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
      if (r.width !== w) s.width = `${(w = r.width)}px`;
      if (r.height !== h) s.height = `${(h = r.height)}px`;
      const cut = t > r.top + 0.5 || l > r.left + 0.5 || b < r.bottom - 0.5 || rt < r.right - 0.5;
      s.clipPath = cut ? `inset(${t - r.top}px ${r.right - rt}px ${r.bottom - b}px ${l - r.left}px)` : "";
      s.setProperty("--x", `${Math.round(x - r.left)}px`);
      s.setProperty("--y", `${Math.round(y - r.top)}px`);
      return true;
    };

    const frame = () => {
      raf = 0;
      if (root.hasAttribute("data-lifting")) {
        show(false);
        lit = null;
      } else if (mode === "mouse") {
        if (mouseIn) {
          const hit = document.elementFromPoint(x, y);
          const el = find(hit);
          // In the gap between two rows of a list, it stays on the last row (as the shade does).
          const gap = !el && !!lit?.list && !!hit && lit.list.contains(hit);
          if (!gap && el !== (lit?.el ?? passed)) {
            const next = el ? describe(el) : null;
            passed = next ? null : el;
            take(next);
          }
          show(paint());
        } else show(false);
      } else if (mode === "touch" && lit) {
        // While the finger holds, the light stays with it; once it lifts, it fades where it was.
        if (finger >= 0) show(paint());
        else if (!lit.box.isConnected) vanish();
      }
      // The page glow eases after the pointer (straight to it when motion is kept down).
      let moving = false;
      if (auraOn) {
        const k = still.matches ? 1 : 0.2;
        const dx = x - ax;
        const dy = y - ay;
        moving = Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4;
        ax += moving ? dx * k : dx;
        ay += moving ? dy * k : dy;
        aura.style.transform = `translate3d(${ax.toFixed(1)}px, ${ay.toFixed(1)}px, 0)`;
      }
      if (--left > 0 || moving) raf = requestAnimationFrame(frame);
    };
    const kick = (n = 24) => {
      left = Math.max(left, n);
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const auraShow = (v: boolean) => {
      if (v === auraOn) return;
      auraOn = v;
      if (v) {
        ax = x;
        ay = y;
        aura.style.transform = `translate3d(${ax}px, ${ay}px, 0)`;
        aura.setAttribute("data-on", "");
      } else aura.removeAttribute("data-on");
    };

    const move = (e: PointerEvent) => {
      if (e.pointerType === "mouse") {
        if (!fine.matches) return;
        if (mode !== "mouse") {
          mode = "mouse";
          lit = null;
        }
        x = e.clientX;
        y = e.clientY;
        mouseIn = true;
        auraShow(true);
        kick();
      } else if (e.pointerId === finger) {
        x = e.clientX;
        y = e.clientY;
        kick(6);
      }
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse") {
        if (mode === "mouse") layer.setAttribute("data-down", "");
        return;
      }
      const el = find(e.target);
      window.clearTimeout(letGo);
      const next = el ? describe(el) : null;
      if (!next) return;
      mode = "touch";
      finger = e.pointerId;
      pressedAt = performance.now();
      x = e.clientX;
      y = e.clientY;
      layer.setAttribute("data-touch", "");
      take(next);
      // The light grows out from the finger.
      layer.setAttribute("data-snap", "");
      layer.style.setProperty("--pl-r", "0px");
      if (!paint()) {
        layer.removeAttribute("data-snap");
        return;
      }
      void getComputedStyle(layer).getPropertyValue("--pl-r");
      layer.removeAttribute("data-snap");
      layer.style.setProperty("--pl-r", `${next.near}px`);
      show(true);
      kick(6);
    };
    const release = () => {
      finger = -1;
      show(false);
      kick(12);
      forget = window.setTimeout(() => {
        if (!on && mode === "touch") lit = null;
      }, 400);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerType === "mouse") {
        layer.removeAttribute("data-down");
        kick(40);
        return;
      }
      if (e.pointerId !== finger) return;
      // A quick tap still shows its light for a moment.
      letGo = window.setTimeout(release, Math.max(0, 180 - (performance.now() - pressedAt)));
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.pointerId === finger) {
        window.clearTimeout(letGo);
        release();
      }
    };
    const out = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.relatedTarget) return;
      // The mouse left the window.
      mouseIn = false;
      auraShow(false);
      kick(2);
    };
    const away = () => {
      mouseIn = false;
      auraShow(false);
      show(false);
    };
    const scrolled = () => {
      if (mode === "mouse" && mouseIn) kick();
      else if (mode === "touch" && finger < 0 && on) show(false);
    };
    const opts = { passive: true } as const;
    document.addEventListener("pointermove", move, opts);
    document.addEventListener("pointerdown", down, opts);
    document.addEventListener("pointerup", up, opts);
    document.addEventListener("pointercancel", cancel, opts);
    document.addEventListener("pointerout", out, opts);
    document.addEventListener("scroll", scrolled, { passive: true, capture: true });
    window.addEventListener("blur", away);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("blur", away);
      window.clearTimeout(letGo);
      window.clearTimeout(forget);
      cancelAnimationFrame(raf);
      layer.remove();
      aura.remove();
    };
  }, []);
  return null;
}
