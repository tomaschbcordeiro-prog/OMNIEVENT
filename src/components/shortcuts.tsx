"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

const GO: [string, string, string][] = [
  ["h", "/", "Globe"],
  ["e", "/events", "All events"],
  ["d", "/destinations", "Destinations"],
  ["m", "/match", "Event Match"],
  ["t", "/mixtape", "Mixtape"],
  ["c", "/community", "Community"],
  ["l", "/clubs", "Clubs"],
  ["s", "/studio", "Studio"],
  ["w", "/my-world", "My World"],
];

/** Keyboard shortcuts across the site: "/" to search, "?" for the list, "g" then a letter to go. */
export function Shortcuts() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const pendingG = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true], [role=dialog]:not([data-shortcuts])")) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "Escape" && open) return setOpen(false);
      if (e.key === "/") {
        const box = [...document.querySelectorAll<HTMLInputElement>("input[data-search-input]")].find((el) => el.offsetParent !== null);
        if (box) {
          e.preventDefault();
          box.focus();
          box.select();
          return;
        }
        // Where the search field is folded into a button, open it (it focuses itself).
        const fold = document.querySelector<HTMLButtonElement>('header button[aria-label="Search"]');
        if (fold && fold.offsetParent !== null) {
          e.preventDefault();
          fold.click();
        }
        return;
      }
      if (e.key === "g") {
        pendingG.current = Date.now();
        return;
      }
      if (Date.now() - pendingG.current < 1200) {
        const hit = GO.find(([k]) => k === e.key.toLowerCase());
        pendingG.current = 0;
        if (hit) {
          e.preventDefault();
          setOpen(false);
          router.push(hit[1]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, router]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-labelledby="kb-h" data-shortcuts className="surface-float w-full max-w-md rounded-[var(--radius-l)] p-5 panel-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 id="kb-h" className="t-h3">Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={() => setOpen(false)}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 t-small">
          <dt><kbd className="kbd">⌘</kbd> <kbd className="kbd">K</kbd></dt>
          <dd>Command menu: jump anywhere</dd>
          <dt><kbd className="kbd">/</kbd></dt>
          <dd>Search</dd>
          <dt><kbd className="kbd">?</kbd></dt>
          <dd>Show or hide this list</dd>
          <dt><kbd className="kbd">j</kbd> <kbd className="kbd">k</kbd></dt>
          <dd>Next or previous event in a list (Enter opens it)</dd>
          {GO.map(([k, , label]) => (
            <div key={k} className="contents">
              <dt><kbd className="kbd">g</kbd> <kbd className="kbd">{k}</kbd></dt>
              <dd>Go to {label}</dd>
            </div>
          ))}
        </dl>
        <p className="t-micro text-text-3 mt-4">On the globe: arrows move, + and − zoom. In Night Flight: space pauses, arrows skip.</p>
      </section>
    </div>
  );
}
