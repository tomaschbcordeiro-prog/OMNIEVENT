"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CalendarRange, Gift, Loader2, LocateFixed, Moon, PartyPopper, Sunrise } from "lucide-react";
import { toast } from "./toast";
import type { SearchFilters } from "@/lib/types";
import { activeQuick, quickPicks, toggleQuick, type QuickId } from "@/lib/search/quick";

/** What a search "near me" is called in its chips and title. */
const NEAR_ME = "Near you";

const ICONS: Record<QuickId, typeof Moon> = { today: CalendarDays, tonight: Moon, tomorrow: Sunrise, weekend: PartyPopper, week: CalendarRange, free: Gift };

/**
 * One tap for the questions people ask first: what's on today, tonight, tomorrow, this
 * weekend, this week, and what's free. The chip lights up at once; the list follows.
 */
export function QuickWhen({ f, onChange, className = "" }: { f: SearchFilters; onChange: (f: SearchFilters) => void; className?: string }) {
  // The visitor's own day, known once the page runs in their browser (the server's clock
  // may be on another date).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  // Shown as tapped straight away, before the new results arrive.
  const [shown, setShown] = useState(f);
  useEffect(() => setShown(f), [f]);
  const on = now ? activeQuick(shown, now) : new Set<QuickId>();
  const picks = quickPicks(now ?? new Date());

  // "Near me": the device's position (asked for only on this tap), within 10 km.
  const [locating, setLocating] = useState(false);
  const nearMe = shown.near && shown.nearLabel === NEAR_ME;
  const toggleNear = () => {
    if (nearMe) {
      const next = { ...shown, near: undefined, nearLabel: undefined, sort: shown.sort === "distance" ? undefined : shown.sort, page: undefined };
      setShown(next);
      return onChange(next);
    }
    if (!navigator.geolocation) return toast({ title: "Location isn't available in this browser", body: "Pick a city instead.", emoji: "🧭" });
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const next: SearchFilters = { ...shown, near: { lat: pos.coords.latitude, lng: pos.coords.longitude, radiusKm: 10 }, nearLabel: NEAR_ME, city: undefined, country: undefined, continent: undefined, page: undefined };
        setShown(next);
        onChange(next);
      },
      () => {
        setLocating(false);
        toast({ title: "We couldn't get your location", body: "Allow location for this site, or pick a city instead.", emoji: "🧭" });
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };

  return (
    <div className={`flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 ${className}`} role="group" aria-label="Near me, when, and free">
      <button type="button" className="chip quick-chip quick-near" aria-pressed={!!nearMe} aria-busy={locating} onClick={toggleNear}>
        {locating ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <LocateFixed size={14} aria-hidden />}
        Near me
      </button>
      {picks.map((p) => {
        const Icon = ICONS[p.id];
        const pressed = on.has(p.id);
        return (
          <button
            key={p.id}
            type="button"
            className={`chip quick-chip ${p.id === "free" ? "quick-free" : ""}`}
            aria-pressed={pressed}
            onClick={() => {
              const next = toggleQuick(shown, p.id, now ?? new Date());
              setShown(next);
              try {
                navigator.vibrate?.(8);
              } catch {
                // not on this device
              }
              onChange(next);
            }}
          >
            <Icon size={14} aria-hidden />
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
