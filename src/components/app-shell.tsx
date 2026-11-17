"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";

/*
 * The site as an app on a phone: the service worker (instant return visits, the last pages and
 * saved events without a network) and installing it on the home screen.
 */

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let deferred: InstallEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export interface InstallState {
  /** Running as an installed app already. */
  standalone: boolean;
  /** The browser can install it with one tap (Android, desktop Chrome and Edge). */
  canPrompt: boolean;
  /** iPhone or iPad in Safari: installed from the Share menu. */
  ios: boolean;
}

const SERVER: InstallState = { standalone: false, canPrompt: false, ios: false };
let snapshot: InstallState = SERVER;
function read(): InstallState {
  const standalone = installed || window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
  const next = { standalone, canPrompt: !!deferred && !standalone, ios: ios && !standalone };
  if (next.standalone !== snapshot.standalone || next.canPrompt !== snapshot.canPrompt || next.ios !== snapshot.ios) snapshot = next;
  return snapshot;
}

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => SERVER,
  );
}

/** Shows the browser's own "Install app" dialog; true if it was installed. */
export async function installApp(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === "accepted") installed = true;
  emit();
  return outcome === "accepted";
}

/**
 * Installed, there's no browser to reload with: pulling down from the top of a page fetches it
 * again, as apps do (not on the globe, maps, sheets or dialogs, which pull for themselves).
 */
function usePullToRefresh() {
  const router = useRouter();
  const path = usePathname();
  const where = useRef(path);
  where.current = path;
  useEffect(() => {
    if (!read().standalone) return;
    const dot = document.createElement("div");
    dot.className = "ptr";
    dot.setAttribute("aria-hidden", "true");
    document.body.append(dot);
    let y0 = 0;
    let pull = 0;
    let on = false;
    const SKIP = ".maplibregl-map, dialog, .tab-sheet, .trip-stage, .addx, .show, [data-no-ptr], input, textarea, select";
    const start = (e: TouchEvent) => {
      on = window.scrollY <= 0 && e.touches.length === 1 && where.current !== "/" && !(e.target as Element).closest?.(SKIP);
      y0 = e.touches[0]?.clientY ?? 0;
      pull = 0;
    };
    const move = (e: TouchEvent) => {
      if (!on) return;
      pull = Math.max(0, Math.min(110, ((e.touches[0]?.clientY ?? 0) - y0) * 0.5));
      if (window.scrollY > 0) pull = 0;
      dot.style.setProperty("--pull", String(pull));
      if (pull >= 64) dot.dataset.ready = "";
      else delete dot.dataset.ready;
    };
    const end = () => {
      if (!on) return;
      on = false;
      if (pull >= 64) {
        dot.dataset.busy = "";
        navigator.vibrate?.(8);
        router.refresh();
        window.setTimeout(() => {
          delete dot.dataset.busy;
          delete dot.dataset.ready;
          dot.style.setProperty("--pull", "0");
        }, 900);
      } else dot.style.setProperty("--pull", "0");
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      dot.remove();
    };
  }, [router]);
}

/** Mounted once in the layout. */
export function AppShell() {
  usePullToRefresh();
  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Kept for the "Install the app" button instead of the browser's own banner.
      e.preventDefault();
      deferred = e as InstallEvent;
      emit();
    };
    const onInstalled = () => {
      installed = true;
      deferred = null;
      emit();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // The service worker, once the page has loaded (it never slows the first visit).
    const register = () => {
      if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("load", register);
    };
  }, []);
  return null;
}
