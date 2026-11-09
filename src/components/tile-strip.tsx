"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A row of event tiles that scrolls sideways. Phones swipe it; with a mouse, arrows appear on
 * either side (sideways scrolling with a mouse isn't obvious), and the edges fade where more
 * tiles are hidden.
 */
export function TileStrip({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  const list = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const update = () => setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, []);

  const by = (dir: -1 | 1) => {
    const el = list.current;
    if (!el) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.85), behavior: smooth ? "smooth" : "auto" });
  };

  return (
    <div className="strip-wrap mt-3" data-start={edges.start || undefined} data-end={edges.end || undefined}>
      <ul ref={list} className={`tile-strip no-scrollbar ${className}`} aria-label={label}>
        {children}
      </ul>
      <button type="button" className="strip-arrow strip-prev" aria-label={`Scroll back: ${label}`} disabled={edges.start} onClick={() => by(-1)}>
        <ChevronLeft size={18} aria-hidden />
      </button>
      <button type="button" className="strip-arrow strip-next" aria-label={`Scroll on: ${label}`} disabled={edges.end} onClick={() => by(1)}>
        <ChevronRight size={18} aria-hidden />
      </button>
    </div>
  );
}
