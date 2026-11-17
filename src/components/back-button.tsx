"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

/** The places the bottom bar goes to: nothing to go back to from there. */
const TOP = new Set(["/", "/events", "/my-world", "/offline"]);

/**
 * "Back", in the installed app only. Opened from the home screen, Mundivi has no browser
 * around it, so no back button (an iPhone has no system one either). In a browser tab
 * the browser's own button is there, so this stays out of the way.
 */
export function BackButton() {
  const path = usePathname();
  const router = useRouter();
  const [app, setApp] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(display-mode: standalone)");
    const check = () => setApp(!!mq?.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    check();
    mq?.addEventListener?.("change", check);
    return () => mq?.removeEventListener?.("change", check);
  }, []);
  if (!app || TOP.has(path)) return null;
  return (
    <button
      type="button"
      className="back-btn press"
      aria-label="Back"
      // Opened straight on this page (a shared link), there's no page before it: go to the events.
      onClick={() => (window.history.length > 1 ? router.back() : router.push("/events"))}
    >
      <ChevronLeft size={24} aria-hidden />
    </button>
  );
}
