"use client";

import { useEffect } from "react";
import { userActions, useUser, type SavedSnap } from "@/lib/user/store";
import { toast } from "./toast";

/**
 * The end of the trip to the ticket seller (peak-end rule: how it ends is what's remembered).
 * Someone who opened a seller's page and comes back to this tab gets one short note: save the
 * event if it isn't saved yet, so it's in My World and their calendar, or simply "enjoy it".
 * Once per event and visit; never while they're still on the seller's page.
 */
export function TicketReturn({ id, title, snap }: { id: string; title: string; snap?: SavedSnap }) {
  const user = useUser();
  const saved = user.saved.some((s) => s.id === id);
  useEffect(() => {
    const key = `omnievent:ticket-return:${id}`;
    let leftAt = 0;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("/out/") || a.hasAttribute("data-ticket")) leftAt = Date.now();
    };
    const onBack = () => {
      if (document.visibilityState !== "visible" || !leftAt) return;
      const away = Date.now() - leftAt;
      leftAt = 0;
      // A quick glance away isn't a visit to the seller; an hour later it's a different moment.
      if (away < 4000 || away > 60 * 60 * 1000) return;
      try {
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
      } catch {
        // private mode: may show again on this visit, which is harmless
      }
      if (saved) toast({ title: "Enjoy it!", body: `${title} is in My World, with directions and your calendar.`, emoji: "🎟️", href: "/my-world", linkLabel: "My World" });
      else toast({ title: "Got your tickets?", body: `Save ${title} to find it fast and add it to your calendar.`, emoji: "🎟️", action: { label: "Save", run: () => userActions.toggleSave(id, snap) } });
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onBack);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onBack);
    };
  }, [id, title, snap, saved]);
  return null;
}
