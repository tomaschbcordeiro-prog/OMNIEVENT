"use client";

import { useEffect, useRef, useState } from "react";
import { PosterArt, POSTER_H, POSTER_W, type PosterData, type PosterStyle } from "@/lib/studio/poster";

/** A Studio poster drawn at full size and scaled to fit its box (16:9), exactly as it will look. */
export function ScaledPoster({ data, styleId, className = "", label }: { data: PosterData; styleId: PosterStyle; className?: string; label?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / POSTER_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} role="img" aria-label={label ?? `Poster: ${data.title}`} className={`relative overflow-hidden ${className}`} style={{ aspectRatio: `${POSTER_W} / ${POSTER_H}` }}>
      {scale > 0 && (
        <div aria-hidden style={{ position: "absolute", left: 0, top: 0, width: POSTER_W, height: POSTER_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <PosterArt data={data} styleId={styleId} font="var(--font-geist-sans)" />
        </div>
      )}
    </div>
  );
}
