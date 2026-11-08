"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_KEY as KEY } from "@/lib/theme-boot";

export type ThemePref = "light" | "dark" | "system";

export function themePref(): ThemePref {
  try {
    const t = localStorage.getItem(KEY);
    return t === "dark" || t === "light" ? t : "system";
  } catch {
    return "system";
  }
}

export function isDarkNow(): boolean {
  const set = document.documentElement.getAttribute("data-theme");
  if (set === "dark") return true;
  if (set === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // private mode: this page only
  }
  window.dispatchEvent(new Event("omni:theme"));
}

/**
 * Changes the theme. From a point on screen (the button), the new one spreads out in a
 * circle where the browser can show it (View Transitions), and simply swaps elsewhere.
 */
export function setTheme(pref: ThemePref, from?: { x: number; y: number }) {
  type VT = { ready: Promise<void> };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => VT };
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || reduced || !from) return apply(pref);
  const root = document.documentElement;
  root.classList.add("theme-vt");
  const vt = doc.startViewTransition(() => apply(pref));
  const r = Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y));
  vt.ready
    .then(() =>
      root.animate({ clipPath: [`circle(0px at ${from.x}px ${from.y}px)`, `circle(${r}px at ${from.x}px ${from.y}px)`] }, { duration: 520, easing: "cubic-bezier(0.4, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" }).finished,
    )
    .catch(() => {})
    .finally(() => root.classList.remove("theme-vt"));
}

/** Follows the theme as it changes (the button, the command menu, or the device). */
export function useDark(): boolean | null {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const read = () => setDark(isDarkNow());
    read();
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener?.("change", read);
    window.addEventListener("omni:theme", read);
    return () => {
      mq?.removeEventListener?.("change", read);
      window.removeEventListener("omni:theme", read);
    };
  }, []);
  return dark;
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const dark = useDark();
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      className={`btn btn-ghost btn-icon theme-toggle ${className}`}
      aria-label={label}
      title={label}
      onClick={(e) => {
        const b = e.currentTarget.getBoundingClientRect();
        setTheme(isDarkNow() ? "light" : "dark", { x: b.left + b.width / 2, y: b.top + b.height / 2 });
      }}
    >
      {/* Both icons are drawn; CSS turns one into the other (a moon by day, a sun by night).
          Before the theme is known, neither shows. */}
      <span className="theme-icon" data-dark={dark === null ? undefined : String(dark)} aria-hidden>
        <Sun size={18} className="theme-sun" />
        <Moon size={18} className="theme-moon" />
      </span>
    </button>
  );
}
