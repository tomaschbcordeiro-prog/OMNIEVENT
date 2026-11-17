"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RotateCw, WifiOff } from "lucide-react";
import { useUser } from "@/lib/user/store";
import { formatShortDate } from "@/lib/format";

/** Offline: what's kept on the phone (saved events, trips), and a way back once online. */
export function OfflineView() {
  const user = useUser();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    // Back online: the page that was asked for, at last.
    const back = () => window.location.reload();
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, []);
  const now = new Date().toISOString();
  const saved = mounted ? user.saved.filter((s) => s.snap && s.snap.start >= now.slice(0, 10)).sort((a, b) => a.snap!.start.localeCompare(b.snap!.start)).slice(0, 30) : [];
  const trips = mounted ? user.trips : [];
  return (
    <main className="mx-auto max-w-[640px] px-4 pt-10 pb-16">
      <span className="grid place-items-center w-14 h-14 rounded-2xl bg-panel border border-line" aria-hidden><WifiOff size={26} className="text-text-2" /></span>
      <h1 className="t-h1 mt-4">No connection</h1>
      <p className="t-body text-text-2 mt-2">This page needs the internet; it opens by itself when you&apos;re back online. Your saved events and trips are still here on your phone.</p>
      <button type="button" className="btn btn-primary mt-4 press" onClick={() => window.location.reload()}><RotateCw size={16} aria-hidden /> Try again</button>
      {saved.length > 0 && (
        <section className="mt-8" aria-labelledby="off-saved">
          <h2 id="off-saved" className="t-h3">Saved events</h2>
          <ul className="mt-3 divide-y divide-line rounded-[var(--radius-l)] border border-line bg-panel">
            {saved.map((s) => {
              const d = formatShortDate(s.snap!.start, s.snap!.timeZone);
              return (
                <li key={s.id}>
                  <Link href={`/events/${s.snap!.slug}`} className="flex items-center gap-3 px-4 py-3">
                    <span className="text-center w-10 shrink-0 leading-tight"><span className="block text-[11px] text-text-2 uppercase">{d.month}</span><span className="block font-bold tnum">{d.day}</span></span>
                    <span className="min-w-0">
                      <span className="block font-semibold truncate">{s.snap!.title}</span>
                      <span className="block t-micro text-text-2 truncate">{s.snap!.venueName}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {trips.length > 0 && (
        <section className="mt-8" aria-labelledby="off-trips">
          <h2 id="off-trips" className="t-h3">Your trips</h2>
          <ul className="mt-3 grid gap-2">
            {trips.map((t) => (
              <li key={t.id}>
                <Link href={`/trips/${t.id}`} className="flex items-center gap-2 rounded-[var(--radius-m)] border border-line bg-panel px-4 py-3 font-semibold">
                  <span aria-hidden>{t.emoji ?? "✈️"}</span> {t.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
