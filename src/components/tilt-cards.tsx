"use client";

import { useEffect } from "react";

/**
 * Event cards lean gently towards the pointer, with a soft light where it is. Mouse and
 * trackpad only, and never with reduced motion. One listener for the whole page.
 */
export function TiltCards() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let current: HTMLElement | null = null;
    let frame = 0;
    const reset = (el: HTMLElement) => {
      delete el.dataset.tilt;
      for (const v of ["--rx", "--ry", "--gx", "--gy"]) el.style.removeProperty(v);
    };
    const move = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>(".tile") ?? null;
      if (current && current !== el) reset(current);
      current = el;
      if (!el) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
        el.style.setProperty("--rx", `${((0.5 - y) * 6).toFixed(2)}deg`);
        el.style.setProperty("--ry", `${((x - 0.5) * 8).toFixed(2)}deg`);
        el.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
        el.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
        el.dataset.tilt = "";
      });
    };
    const leave = () => {
      if (current) reset(current);
      current = null;
    };
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
    };
  }, []);
  return null;
}
