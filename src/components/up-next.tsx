"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Navigation, X } from "lucide-react";
import { useUser } from "@/lib/user/store";
import { formatEventTime, localDateKey } from "@/lib/format";
import { Poster } from "./ui";
import { tidyTitle } from "@/lib/title";

/*
 * The saved event coming up next (today, tonight or tomorrow), at the top of the events list:
 * when it is, where, and the way there, one tap away. Closed with ×, it stays closed.
 */

const KEY = "omnievent:upnext-closed";
const HOUR = 3_600_000;

function closedIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function UpNext() {
  const user = useUser();
  const [now, setNow] = useState<number | null>(null);
  const [closed, setClosed] = useState<string[]>([]);
  useEffect(() => {
    setNow(Date.now());
    setClosed(closedIds());
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  if (now == null) return null;
  // Started up to two hours ago, or starting in the next day and a half.
  const next = user.saved
    .filter((s) => s.snap && !closed.includes(s.id))
    .map((s) => ({ s, at: Date.parse(s.snap!.start) }))
    .filter(({ at }) => at > now - 2 * HOUR && at < now + 36 * HOUR)
    .sort((a, b) => a.at - b.at)[0];
  if (!next) return null;
  const snap = next.s.snap!;
  const today = localDateKey(new Date(now), snap.timeZone);
  const day = localDateKey(snap.start, snap.timeZone);
  const time = snap.hoursUnknown || snap.eventType === "daily_attraction" ? "" : formatEventTime(snap.start, snap.timeZone);
  const started = next.at <= now;
  const hour = Number(time.slice(0, 2));
  const when = started ? "On now" : day === today ? (hour >= 18 ? "Tonight" : "Today") : "Tomorrow";
  const close = () => {
    const ids = [...closedIds(), next.s.id].slice(-50);
    try {
      localStorage.setItem(KEY, JSON.stringify(ids));
    } catch {
      // private mode: closed for this visit
    }
    setClosed(ids);
  };
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(snap.venueName)}`;
  return (
    <aside className="up-next panel-in" aria-label="Your next saved event">
      <Poster title={snap.title} imageUrl={snap.imageUrl} hue={snap.posterHue} categorySlug={snap.categorySlug} size="sm" className="up-next-pic" />
      <div className="min-w-0 flex-1">
        <p className="up-next-when">
          <span className="up-next-dot" data-live={started || undefined} aria-hidden />
          {when}
          {time && !started ? ` · ${time}` : ""}
        </p>
        <Link href={`/events/${snap.slug}`} className="up-next-title">{tidyTitle(snap.title)}</Link>
        <p className="t-micro text-text-2 truncate">{snap.venueName}</p>
      </div>
      <div className="up-next-actions">
        <a href={maps} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm press" aria-label={`Directions to ${snap.venueName}`}>
          <Navigation size={14} aria-hidden /> <span className="max-sm:sr-only">Directions</span>
        </a>
        <Link href={`/events/${snap.slug}`} className="btn btn-primary btn-sm press" aria-label={`Open ${snap.title}`}>
          <span className="max-sm:sr-only">Open</span> <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      <button type="button" className="up-next-x" onClick={close} aria-label="Hide this reminder"><X size={14} aria-hidden /></button>
    </aside>
  );
}
