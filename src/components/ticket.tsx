"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "@/lib/user/store";

/**
 * The ink stamp on an event's ticket once it's saved. Saving it here presses the stamp on
 * (with a small buzz on phones); an event saved on an earlier visit simply shows it.
 */
export function TicketStamp({ id }: { id: string }) {
  const user = useUser();
  const saved = user.saved.some((s) => s.id === id);
  const was = useRef(saved);
  const since = useRef(0);
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    since.current = performance.now();
  }, []);

  useEffect(() => {
    // The first moments after the page opens are the saved list being read, not a save.
    const settled = performance.now() - since.current > 600;
    if (saved && !was.current && settled) {
      setFresh(true);
      try {
        navigator.vibrate?.([10, 50, 16]);
      } catch {
        // no vibration on this device
      }
    }
    if (!saved) setFresh(false);
    was.current = saved;
  }, [saved]);

  if (!saved) return null;
  return (
    <span className="ticket-stamp" data-fresh={fresh || undefined} aria-hidden>
      Saved
    </span>
  );
}
