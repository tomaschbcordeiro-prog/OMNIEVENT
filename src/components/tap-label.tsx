"use client";

import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * Icon buttons say what they do: on a touch screen, tapping one shows its name for a moment
 * just above it (a mouse sees the same name on hover). Watches every button inside `within`.
 */
export function TapLabel({ within }: { within: RefObject<HTMLElement | null> }) {
  const [label, setLabel] = useState<{ text: string; x: number; y: number; key: number } | null>(null);
  useEffect(() => {
    const root = within.current;
    if (!root) return;
    let pending: { text: string; el: HTMLElement } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The name as the button had it when pressed: what was just done, before it changes.
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("button[aria-label]");
      pending = el && root.contains(el) ? { text: el.getAttribute("aria-label")!, el } : null;
    };
    const up = () => {
      if (!pending) return;
      const r = pending.el.getBoundingClientRect();
      setLabel({ text: pending.text, x: r.left + r.width / 2, y: r.top, key: Date.now() });
      pending = null;
      clearTimeout(timer);
      timer = setTimeout(() => setLabel(null), 1400);
    };
    root.addEventListener("pointerdown", down);
    root.addEventListener("pointerup", up);
    return () => {
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointerup", up);
      clearTimeout(timer);
    };
  }, [within]);
  if (!label) return null;
  return createPortal(
    <span key={label.key} className="tap-label" style={{ left: label.x, top: label.y }} aria-hidden>
      {label.text}
    </span>,
    document.body,
  );
}
