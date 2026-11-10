"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** The link followed, while its page loads. */
let pendingLink: HTMLAnchorElement | null = null;
function settle() {
  pendingLink?.removeAttribute("data-pending");
  pendingLink = null;
}

/**
 * A thin bar along the top while the next page loads: it starts when a link to another page
 * on the site is followed, and finishes when that page is showing. The link itself shows it's
 * on its way too (data-pending), where the eye and the finger are.
 */
export function NavProgress() {
  const path = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const timer = useRef<number | undefined>(undefined);
  const where = `${path}?${search}`;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download") || a.dataset.noProgress != null) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Same page (or just an anchor on it): nothing to load.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      window.clearTimeout(timer.current);
      settle();
      a.setAttribute("data-pending", "");
      pendingLink = a;
      setState("loading");
      // Never stuck: a navigation that's cancelled or fails just fades away.
      timer.current = window.setTimeout(() => {
        settle();
        setState("idle");
      }, 8000);
    };
    // Before the page's own handlers (links navigate in their click handler).
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    settle();
    setState((s) => (s === "loading" ? "done" : s));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 500);
  }, [where]);

  return <div className="nav-progress" data-state={state} aria-hidden />;
}
