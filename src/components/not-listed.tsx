"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { EventRow } from "@/components/event-card";
import { SearchBox } from "@/components/search-box";
import type { EventCard } from "@/lib/types";

/** Words of an event's address worth searching for ("noite-de-fado-lisboa-123456" → "noite fado lisboa"). */
function wordsOf(path: string): string {
  const slug = decodeURIComponent(path.split("/").pop() ?? "");
  return slug
    .split("-")
    // Ids and numbers ("433670", "19nakgh") and small words aren't worth searching for.
    .filter((w) => w.length >= 3 && !/\d/.test(w) && !/^(the|and|des|les|del|con|com|uma|for|und|der|die|das)$/.test(w))
    .slice(0, 6)
    .join(" ");
}

const TEXT = {
  event: { kicker: "Event not found", title: "This event isn't listed any more", lede: "It may have ended, or its organiser took it down. Here's what's coming up that looks like it." },
  venue: { kicker: "Venue not found", title: "We don't list this venue right now", lede: "Our sources have nothing on there at the moment. Here's what's coming up under the same words." },
  performer: { kicker: "Not found", title: "Nothing listed for this name right now", lede: "Our sources have no dates for them at the moment. Here's what's coming up under the same words." },
};

/**
 * A page that isn't listed (any more): usually a link to an event that has ended. Instead of a
 * dead end, what's coming up under the same words as its address.
 */
export function NotListed({ kind }: { kind: "event" | "venue" | "performer" }) {
  const path = usePathname();
  const all = wordsOf(path);
  const [items, setItems] = useState<EventCard[] | null>(null);
  const [words, setWords] = useState(all);
  useEffect(() => {
    if (!all) return setItems([]);
    const ctrl = new AbortController();
    // Every word must match, so when nothing does, fewer words: the first three, two, one.
    const tries = [...new Set([all, ...[3, 2, 1].map((n) => all.split(" ").slice(0, n).join(" "))])];
    (async () => {
      for (const q of tries) {
        const r = await fetch(`/api/events?q=${encodeURIComponent(q)}&size=6`, { signal: ctrl.signal });
        const j = (r.ok ? await r.json() : { items: [] }) as { items?: EventCard[] };
        if (j.items?.length) {
          setWords(q);
          return setItems(j.items);
        }
      }
      setItems([]);
    })().catch(() => {});
    return () => ctrl.abort();
  }, [all]);

  return (
    <main className="mx-auto max-w-3xl px-4 pt-20 pb-24">
      <p className="t-small font-semibold text-text-3">{TEXT[kind].kicker}</p>
      <h1 className="t-h1 mt-1">{TEXT[kind].title}</h1>
      <p className="t-lede text-text-2 mt-3">{TEXT[kind].lede}</p>
      <SearchBox className="mt-6" placeholder="Search events, artists, places" initial={all} />
      {items === null ? (
        <div className="mt-6 grid gap-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14" />)}</div>
      ) : items.length ? (
        <section className="mt-6" aria-label="Similar upcoming events">
          <ul className="divide-y divide-line">{items.map((c) => <EventRow key={c.id} c={c} />)}</ul>
          <Link href={`/events?q=${encodeURIComponent(words)}&where=any`} className="btn btn-secondary btn-sm mt-4">See all results</Link>
        </section>
      ) : (
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/" className="btn btn-primary">Explore the globe</Link>
          <Link href="/events" className="btn btn-secondary">Browse all events</Link>
        </div>
      )}
    </main>
  );
}
