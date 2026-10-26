"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import type { EventCard as Card } from "@/lib/types";
import { formatEventTime, formatShortDate, formatDistance } from "@/lib/format";
import { CategoryIcon, categoryLabel, DemoBadge, Poster, Price, SaveButton, StatusBadge } from "./ui";
import { useUser } from "@/lib/user/store";

function peopleLine(c: Card): string | undefined {
  if (!c.people.length) return undefined;
  if (c.sports && c.people.length === 2 && c.people.every((p) => p.role.startsWith("team"))) return `${c.people[0].name} vs ${c.people[1].name}`;
  const names = c.people.slice(0, 3).map((p) => p.name);
  return names.join(", ") + (c.people.length > 3 ? ` and ${c.people.length - 3} more` : "");
}

/** Date block: the event's local date, which is what ticket-holders need. */
function DateBlock({ c }: { c: Card }) {
  const d = formatShortDate(c.start, c.timeZone);
  if (c.eventType === "daily_attraction")
    return (
      <div className="w-12 shrink-0 text-center leading-none">
        <div className="text-[11px] text-text-3">Open</div>
        <div className="text-[13px] font-semibold mt-1">daily</div>
      </div>
    );
  return (
    <div className="w-12 shrink-0 text-center leading-none tnum" aria-hidden>
      <div className="text-[11px] text-text-3">{d.weekday}</div>
      <div className="text-xl font-semibold mt-0.5">{d.day}</div>
      <div className="text-[11px] text-text-2 mt-0.5">{d.month}</div>
    </div>
  );
}

export function EventRow({
  c, onSelect, compact = false, highlighted = false, onHover,
}: { c: Card; onSelect?: (c: Card) => void; compact?: boolean; highlighted?: boolean; onHover?: (c: Card | null) => void }) {
  const user = useUser();
  const people = peopleLine(c);
  const body = (
    <>
      <DateBlock c={c} />
      {!compact && <Poster title={c.title} imageUrl={c.imageUrl} hue={c.posterHue} categorySlug={c.categorySlug} size="sm" className="h-14 w-14 shrink-0 rounded-[var(--radius-s)] hidden sm:block" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[12px] text-text-2">
          <CategoryIcon slug={c.categorySlug} size={13} />
          <span className="truncate">
            {c.sports?.competition ?? categoryLabel(c.categorySlug)}
            {c.sports?.stage && <span className="text-text-3">, {c.sports.stage}</span>}
          </span>
        </div>
        <p className="font-semibold leading-snug truncate mt-0.5 group-hover:text-cyan transition-colors">{c.title}</p>
        {people && people !== c.title && <p className="t-small text-text-2 truncate">{people}</p>}
        <p className="t-small text-text-3 truncate flex items-center mt-0.5">
          <MapPin size={12} aria-hidden className="shrink-0 mr-1" />
          <span className="truncate">
            {c.venueName}, {c.city}
          </span>
          {c.eventType !== "daily_attraction" && !c.hoursUnknown && <span className="tnum shrink-0">, {formatEventTime(c.start, c.timeZone)}</span>}
          {c.distanceKm != null && <span className="shrink-0">, {formatDistance(c.distanceKm)} away</span>}
        </p>
        {compact && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <Price amount={c.fromPrice?.amount} currency={c.fromPrice?.currency} feesIncluded={c.fromPrice?.feesIncluded} isFree={c.isFree} displayCurrency={user.prefs.currency} className="t-micro" />
            {c.isDemo && <DemoBadge />}
            {c.status !== "on_sale" && <StatusBadge status={c.status} />}
          </div>
        )}
      </div>
      <div className={`${compact ? "hidden" : "hidden md:flex"} flex-col items-end gap-1.5 shrink-0 text-right`}>
        <Price amount={c.fromPrice?.amount} currency={c.fromPrice?.currency} feesIncluded={c.fromPrice?.feesIncluded} isFree={c.isFree} displayCurrency={user.prefs.currency} className="t-small" />
        <div className="flex items-center gap-1.5">
          {c.isDemo && <DemoBadge />}
          <StatusBadge status={c.status} />
        </div>
      </div>
    </>
  );
  return (
    <li
      data-venue={c.venueSlug}
      onMouseEnter={onHover ? () => onHover(c) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      onFocusCapture={onHover ? () => onHover(c) : undefined}
      className={`group relative flex items-center gap-3 sm:gap-4 py-3 px-2 -mx-2 rounded-[var(--radius-m)] hover:bg-text/[0.03] ${highlighted ? "bg-cyan/[0.07] ring-1 ring-cyan/40" : ""}`}
    >
      {onSelect ? (
        <button type="button" className="flex flex-1 min-w-0 items-center gap-3 sm:gap-4 text-left" onClick={() => onSelect(c)}>
          {body}
        </button>
      ) : (
        <Link href={`/events/${c.slug}`} className="flex flex-1 min-w-0 items-center gap-3 sm:gap-4">
          {body}
        </Link>
      )}
      {!compact && <div className="flex md:hidden flex-col items-end gap-1 shrink-0">{c.isDemo && <DemoBadge />}</div>}
      <SaveButton id={c.id} title={c.title} compact />
    </li>
  );
}

export function EventTile({ c }: { c: Card }) {
  const user = useUser();
  const people = peopleLine(c);
  const d = formatShortDate(c.start, c.timeZone);
  return (
    <li className="tile group relative flex flex-col overflow-hidden rounded-[var(--radius-m)] border border-line bg-panel">
      <Link href={`/events/${c.slug}`} className="flex flex-col flex-1">
        <div className="relative overflow-hidden">
          <Poster title={c.title} imageUrl={c.imageUrl} hue={c.posterHue} categorySlug={c.categorySlug} className="tile-media aspect-[16/9] w-full" />
          <div className="absolute left-2 bottom-2 flex gap-1.5">
            {c.isDemo && <DemoBadge />}
            {c.status !== "on_sale" && <StatusBadge status={c.status} className="bg-panel/90" />}
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-1 p-3">
          <div className="flex items-center gap-1.5 text-[12px] text-text-2">
            <CategoryIcon slug={c.categorySlug} size={13} />
            <span className="truncate">{c.sports?.competition ?? categoryLabel(c.categorySlug)}</span>
          </div>
          <p className="font-semibold leading-snug line-clamp-2 group-hover:text-cyan transition-colors">{c.title}</p>
          {people && people !== c.title && <p className="t-small text-text-2 truncate">{people}</p>}
          <p className="t-small text-text-3 truncate tnum">
            {c.eventType === "daily_attraction" ? "Open daily" : `${d.weekday} ${d.day} ${d.month}${c.hoursUnknown ? "" : `, ${formatEventTime(c.start, c.timeZone)}`}`}
          </p>
          <p className="t-small text-text-3 truncate">
            {c.venueName}, {c.city}
          </p>
          <div className="mt-auto pt-2 flex items-end justify-between gap-2">
            <Price amount={c.fromPrice?.amount} currency={c.fromPrice?.currency} feesIncluded={c.fromPrice?.feesIncluded} isFree={c.isFree} displayCurrency={user.prefs.currency} className="t-small" />
          </div>
        </div>
      </Link>
      <div className="absolute right-2 top-2">
        <SaveButton id={c.id} title={c.title} compact className="bg-panel/85 backdrop-blur" />
      </div>
    </li>
  );
}
