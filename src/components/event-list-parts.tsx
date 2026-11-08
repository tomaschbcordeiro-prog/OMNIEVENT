"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { EventCard as Card } from "@/lib/types";
import { cardWhen, localDateKey } from "@/lib/format";
import { categoryLabel, CategoryIcon, Poster, Price } from "./ui";
import { EventRow } from "./event-card";
import { useUser } from "@/lib/user/store";

/** "Tonight", "Tomorrow", "In 5 days", "In 3 weeks": how soon, by the event's own calendar. */
export function soonLabel(c: Pick<Card, "start" | "timeZone" | "ongoing">, now = new Date()): string | null {
  if (c.ongoing) return "On now";
  const a = Date.parse(`${localDateKey(now, c.timeZone)}T00:00:00Z`);
  const b = Date.parse(`${localDateKey(c.start, c.timeZone)}T00:00:00Z`);
  const days = Math.round((b - a) / 864e5);
  if (!Number.isFinite(days) || days < 0) return null;
  if (days === 0) return new Date(c.start).getTime() <= now.getTime() ? "On now" : "Today";
  if (days === 1) return "Tomorrow";
  if (days < 14) return `In ${days} days`;
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return `In ${Math.round(days / 30)} months`;
}

/** The soonest event, as a picture you can't miss. */
export function NextUp({ c, showPlace = false }: { c: Card; showPlace?: boolean }) {
  const user = useUser();
  const soon = soonLabel(c);
  return (
    <Link href={`/events/${c.slug}`} className="next-up group">
      <div className="next-up-media">
        <Poster title={c.title} imageUrl={c.imageUrl} hue={c.posterHue} categorySlug={c.categorySlug} size="lg" priority className="absolute inset-0 h-full w-full" />
        <span className="next-up-chip">
          <span className="next-up-dot" aria-hidden />
          Next up{soon ? ` · ${soon}` : ""}
        </span>
      </div>
      <div className="next-up-body">
        <p className="flex items-center gap-1.5 t-micro text-text-2">
          <CategoryIcon slug={c.categorySlug} size={13} />
          {c.sports?.competition ?? categoryLabel(c.categorySlug)}
        </p>
        <p className="next-up-title">{c.title}</p>
        <p className="t-small text-text-2 tnum">
          {cardWhen(c)}
          {showPlace && <span className="text-text-3"> · {c.venueName}, {c.city}</span>}
        </p>
        <div className="mt-2 flex items-center justify-between gap-3">
          <Price amount={c.fromPrice?.amount} currency={c.fromPrice?.currency} feesIncluded={c.fromPrice?.feesIncluded} isFree={c.isFree} displayCurrency={user.prefs.currency} className="t-small" quiet />
          <span className="next-up-go">
            Details <ArrowRight size={14} aria-hidden />
          </span>
        </div>
      </div>
    </Link>
  );
}

/** A long list of dates, split into months with a heading that stays in view while you scroll. */
export function MonthList({ items, label }: { items: Card[]; label: string }) {
  const groups: { key: string; name: string; items: Card[] }[] = [];
  const thisYear = new Date().getUTCFullYear();
  for (const c of items) {
    const ymd = localDateKey(c.ongoing && c.until ? new Date() : c.start, c.timeZone);
    const key = ymd.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const [y, m] = key.split("-").map(Number);
      const name = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "long", year: y === thisYear ? undefined : "numeric", timeZone: "UTC" });
      g = { key, name, items: [] };
      groups.push(g);
    }
    g.items.push(c);
  }
  // One month: no headings needed.
  if (groups.length < 2)
    return (
      <ul className="divide-y divide-line mt-2" aria-label={label}>
        {items.map((c) => <EventRow key={c.id} c={c} />)}
      </ul>
    );
  return (
    <div className="mt-2">
      {groups.map((g) => (
        <section key={g.key} aria-label={`${label}: ${g.name}`} className="month-group">
          <h3 className="month-head">
            {g.name} <span className="month-count tnum">{g.items.length}</span>
          </h3>
          <ul className="divide-y divide-line">{g.items.map((c) => <EventRow key={c.id} c={c} />)}</ul>
        </section>
      ))}
    </div>
  );
}
