"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Star, X } from "lucide-react";
import type { EventCard } from "@/lib/types";
import { useUser } from "@/lib/user/store";
import { askedIds, markAsked, reviewHref, toAskAbout, whenItWas } from "@/lib/after-event";
import { Poster } from "./ui";
import { toast } from "./toast";

/** Whether the community is answering (reviews can be written), checked once per visit. */
let upCheck: Promise<boolean> | null = null;
export function communityUp(): Promise<boolean> {
  upCheck ??= fetch("/api/community?view=feed-head")
    .then((r) => r.ok)
    .catch(() => false);
  return upCheck;
}

type Shown = Pick<EventCard, "id" | "slug" | "title" | "start" | "timeZone" | "venueName" | "imageUrl" | "posterHue" | "categorySlug"> & { eventType: string; venueSlug?: string; ongoing?: boolean; hoursUnknown?: boolean };

/**
 * My World: saved events that are over, each with five stars. A tap on a star opens the event
 * with the review box ready and those stars set; "Didn't go" puts it away.
 */
export function HowWasIt({ cards }: { cards: Map<string, EventCard> }) {
  const user = useUser();
  const router = useRouter();
  const [asked, setAsked] = useState<string[] | null>(null);
  const [up, setUp] = useState(false);
  useEffect(() => {
    setAsked(askedIds());
    void communityUp().then(setUp);
  }, []);
  // The catalogue's copy while it's still listed, else what was kept when it was saved.
  const list = useMemo(
    () => (asked ? toAskAbout(user.saved.map((s) => asked && (cards.get(s.id) ?? (s.snap ? { id: s.id, ...s.snap } : undefined))).filter((c): c is Shown => !!c), asked).slice(0, 3) : []),
    [asked, user.saved, cards],
  );
  if (!up || !list.length) return null;

  const done = (id: string) => {
    markAsked(id);
    setAsked(askedIds());
  };
  return (
    <section aria-labelledby="how-was-it" className="how-was-it">
      <h2 id="how-was-it" className="t-h2">How was it?</h2>
      <p className="t-small text-text-2 mt-1">A few stars and words help the next person decide.</p>
      <ul className="mt-3 grid gap-2">
        {list.map((c) => (
          <li key={c.id} className="how-card">
            <Poster title={c.title} imageUrl={c.imageUrl} hue={c.posterHue} categorySlug={c.categorySlug} size="sm" className="h-12 w-12 shrink-0 rounded-[var(--radius-s)]" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate">{c.title}</p>
              <p className="t-small text-text-2 truncate">
                {c.venueName}, {whenItWas(c.start, c.timeZone)}
              </p>
            </div>
            <div className="how-stars" role="group" aria-label={`Rate ${c.title}`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="how-star"
                  aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
                  onClick={() => {
                    done(c.id);
                    router.push(reviewHref(c, n, cards.has(c.id)));
                  }}
                >
                  <Star size={20} aria-hidden />
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-ghost btn-icon btn-sm text-text-3" aria-label={`Didn't go to ${c.title}`} title="Didn't go" onClick={() => done(c.id)}>
              <X size={16} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Anywhere on the site, once a visit: a quiet note when an event saved here has just taken
 * place, asking how it was (each event is asked about once).
 */
export function AfterEventNudge() {
  const user = useUser();
  const path = usePathname();
  const here = useRef(path);
  here.current = path;
  const saved = useRef(user.saved.slice(0, 40));
  saved.current = user.saved.slice(0, 40);
  const ids = saved.current.map((s) => s.id).join(",");
  useEffect(() => {
    if (!ids) return;
    try {
      // Looked once per visit, whatever it finds.
      if (sessionStorage.getItem("omnievent:nudged")) return;
    } catch {
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        sessionStorage.setItem("omnievent:nudged", "1");
        if (here.current.startsWith("/my-world") || !(await communityUp())) return;
        // The catalogue's copy while it's listed, else the copy kept when it was saved.
        const r = await fetch(`/api/events/batch?ids=${encodeURIComponent(ids)}`, { signal: ctrl.signal });
        if (!r.ok) return;
        const listed = new Map(((await r.json()) as { items: EventCard[] }).items.map((x) => [x.id, x]));
        const all: Shown[] = saved.current.flatMap((x) => {
          const c = listed.get(x.id) ?? (x.snap ? { id: x.id, ...x.snap } : undefined);
          return c ? [c] : [];
        });
        const c = toAskAbout(all, askedIds())[0];
        if (!c || here.current === `/events/${c.slug}`) return;
        markAsked(c.id);
        toast({ title: "How was it?", body: `${c.title}, ${whenItWas(c.start, c.timeZone)}`, emoji: "🎟️", href: reviewHref(c, 0, listed.has(c.id)), linkLabel: "Rate it" });
      } catch {
        // offline or aborted: ask another time
      }
    }, 4000);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [ids]);
  return null;
}
