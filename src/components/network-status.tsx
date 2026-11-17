"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { toast } from "./toast";

/**
 * Says so when the connection drops, and what still works: pages already opened and saved
 * events. Without it, an offline tap just seems to do nothing. When the connection comes back,
 * a short note says that too.
 */
export function NetworkStatus() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let was = !navigator.onLine;
    setOffline(was);
    const update = () => {
      const now = !navigator.onLine;
      setOffline(now);
      if (was && !now) toast({ title: "Back online", emoji: "📶" });
      was = now;
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="net-off panel-in">
      <WifiOff size={15} aria-hidden className="shrink-0" />
      <span>
        <b>You&apos;re offline.</b> Saved events and pages you&apos;ve opened still work.
      </span>
    </div>
  );
}
