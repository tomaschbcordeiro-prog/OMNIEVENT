"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { X } from "lucide-react";

/** Small notes that confirm what just happened ("Saved", "+5 points", a new badge). */

export interface Toast {
  id: number;
  title: string;
  body?: string;
  emoji?: string;
  href?: string;
  linkLabel?: string;
  /** Badges and milestones get a bigger, sunnier card. */
  celebrate?: boolean;
}

let toasts: Toast[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(t: Omit<Toast, "id">) {
  const id = next++;
  toasts = [...toasts.slice(-2), { ...t, id }];
  emit();
  setTimeout(() => dismiss(id), t.celebrate ? 6000 : 3200);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const EMPTY: Toast[] = [];

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => EMPTY,
  );
  // Escape closes the newest one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && toasts.length && dismiss(toasts[toasts.length - 1].id);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6">
      {list.map((t) => (
        <div key={t.id} role="status" className={`toast-in pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-[var(--radius-l)] px-4 py-3 shadow-[0_18px_40px_-16px_rgb(10_30_70_/_0.55)] ${t.celebrate ? "bg-gradient-to-r from-sun to-[#ffd55e] text-text" : "bg-text text-white"}`}>
          {t.emoji && <span className={`${t.celebrate ? "text-3xl pop" : "text-xl"}`} aria-hidden>{t.emoji}</span>}
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-tight">{t.title}</p>
            {t.body && <p className={`t-small leading-snug ${t.celebrate ? "text-text/80" : "text-white/75"}`}>{t.body}</p>}
          </div>
          {t.href && (
            <Link href={t.href} className={`shrink-0 t-small font-semibold underline-offset-2 hover:underline ${t.celebrate ? "text-text" : "text-sun"}`} onClick={() => dismiss(t.id)}>
              {t.linkLabel ?? "Open"}
            </Link>
          )}
          <button type="button" aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100" onClick={() => dismiss(t.id)}>
            <X size={15} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
