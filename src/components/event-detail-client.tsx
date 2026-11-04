"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, Check, ExternalLink, Share2, Plus, CalendarPlus, Info } from "lucide-react";
import type { EventCard, TicketOffer, Cluster } from "@/lib/types";
import { formatMoney, relativeTime, AVAILABILITY_META, TICKET_CATEGORY_LABEL } from "@/lib/format";
import { convert, FX_SOURCE } from "@/lib/currency";
import { userActions, useUser } from "@/lib/user/store";
import { ClusterMap } from "./cluster-map";

export function ViewTracker({ id }: { id: string }) {
  useEffect(() => userActions.viewed(id), [id]);
  return null;
}

export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      onClick={async () => {
        const url = window.location.href;
        try {
          if (navigator.share) await navigator.share({ title, url });
          else {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
        } catch {
          // user cancelled share sheet
        }
      }}
    >
      {copied ? <Check size={14} aria-hidden /> : <Share2 size={14} aria-hidden />}
      {copied ? "Link copied" : "Share"}
    </button>
  );
}

export function AddToTrip({ eventId }: { eventId: string }) {
  const user = useUser();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const inTrips = user.trips.filter((t) => t.eventIds.includes(eventId));
  return (
    <div className="relative">
      <button type="button" className="btn btn-secondary btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Plus size={14} aria-hidden /> {inTrips.length ? `In ${inTrips.length} ${inTrips.length === 1 ? "trip" : "trips"}` : "Add to trip"}
      </button>
      {open && (
        <div className="absolute z-30 mt-1.5 w-72 surface-float rounded-[var(--radius-m)] p-3 panel-in">
          {user.trips.length > 0 && (
            <ul className="grid gap-1 mb-3">
              {user.trips.map((t) => {
                const on = t.eventIds.includes(eventId);
                return (
                  <li key={t.id}>
                    <button type="button" className="w-full flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-text/5 text-sm" aria-pressed={on} onClick={() => userActions.toggleTripEvent(t.id, eventId)}>
                      <span className="truncate">{t.name}</span>
                      {on && <Check size={14} className="text-cyan" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              userActions.createTrip(name.trim(), undefined, undefined, [eventId]);
              setName("");
            }}
          >
            <label className="sr-only" htmlFor="new-trip">New trip name</label>
            <input id="new-trip" className="field !h-8" placeholder="New trip name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-primary btn-sm" disabled={!name.trim()}>Create</button>
          </form>
          <p className="t-micro text-text-3 mt-2">Trips are saved in this browser. <Link href="/my-world?tab=trips" className="underline">Open trip planner</Link></p>
        </div>
      )}
    </div>
  );
}

export function CalendarButton({ slug }: { slug: string }) {
  return (
    <a className="btn btn-secondary btn-sm" href={`/api/events/${slug}/ics`} download>
      <CalendarPlus size={14} aria-hidden /> Add to calendar
    </a>
  );
}

/**
 * Ticket comparison. Offers that include fees and offers that don't are never
 * ranked against each other as if equivalent: they're shown in separate groups.
 */
export function TicketComparison({ offers, eventStatus }: { offers: TicketOffer[]; eventStatus: string }) {
  const user = useUser();
  const [sort, setSort] = useState<"price" | "provider">("price");
  const groups = useMemo(() => {
    const sorter = (a: TicketOffer, b: TicketOffer) =>
      sort === "price" ? (a.totalPrice ?? a.basePrice ?? Infinity) - (b.totalPrice ?? b.basePrice ?? Infinity) : a.provider.localeCompare(b.provider);
    const known = offers.filter((o) => o.totalPrice != null).sort(sorter);
    const base = offers.filter((o) => o.totalPrice == null).sort(sorter);
    return [
      { id: "total", title: "Total price known", note: "Includes all mandatory fees stated by the seller.", items: known },
      { id: "base", title: "Base price only", note: "Fees aren't included or weren't disclosed; the final price at checkout may be higher.", items: base },
    ].filter((g) => g.items.length);
  }, [offers, sort]);
  const inactive = ["cancelled", "completed"].includes(eventStatus);

  if (!offers.length)
    return (
      <p className="t-small text-text-2">
        No ticket offers are listed by our sources for this event. Check the official event website if one is listed above.
      </p>
    );

  return (
    <div>
      <div className={`items-center justify-between gap-3 mb-3 ${offers.length > 1 ? "flex" : "hidden"}`}>
        <p className="t-small text-text-2">
          {offers.length} {offers.length === 1 ? "offer" : "offers"} from {new Set(offers.map((o) => o.provider)).size} {new Set(offers.map((o) => o.provider)).size === 1 ? "seller" : "sellers"}
        </p>
        {offers.length > 2 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSort((s) => (s === "price" ? "provider" : "price"))}>
            <ArrowUpDown size={14} aria-hidden /> Sort by {sort === "price" ? "seller" : "price"}
          </button>
        )}
      </div>
      {inactive && <p className="t-small text-warn mb-3">This event is {eventStatus}. Offers are shown for reference only.</p>}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
        {groups.map((g) => (
          <div key={g.id}>
            {groups.length > 1 ? (
              <p className="t-small mb-1.5">
                <span className="font-semibold">{g.title}</span> <span className="text-text-3">· {g.note}</span>
              </p>
            ) : null}
            <ul className="divide-y divide-line rounded-[var(--radius-m)] border border-line bg-panel">
              {g.items.map((o) => {
                const av = AVAILABILITY_META[o.availability];
                const shown = o.totalPrice ?? o.basePrice;
                const conv = shown != null && user.prefs.currency !== o.currency ? convert(shown, o.currency, user.prefs.currency) : undefined;
                return (
                  <li key={o.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {o.provider}
                        {o.sponsored && <span className="ml-1.5 t-micro text-text-3">sponsored</span>}
                      </p>
                      <p className="t-micro text-text-3 truncate">
                        {o.label && o.label !== "standard" ? o.label : TICKET_CATEGORY_LABEL[o.ticketCategory]}
                        {o.availability !== "available" && o.availability !== "unknown" && <> · <span className={av.tone === "bad" ? "text-bad" : av.tone === "warn" ? "text-warn" : ""}>{av.label}</span></>}
                        {/* Relative to now: the page's HTML may be a few minutes older than this render. */}
                        {o.priceObservedAt && <span suppressHydrationWarning> · checked {relativeTime(o.priceObservedAt)}</span>}
                      </p>
                    </div>
                    <div className="text-right tnum">
                      {shown != null ? (
                        <>
                          <span className="font-semibold">{formatMoney(shown, o.currency)}</span>
                          {o.maxPrice != null && o.maxPrice > (o.basePrice ?? 0) && <span className="text-text-3"> to {formatMoney(o.maxPrice, o.currency)}</span>}
                          <span className="block t-micro text-text-3">
                            {o.totalPrice != null ? (o.feeAmount != null ? `incl. ${formatMoney(o.feeAmount, o.currency)} fees` : "fees included") : o.feesIncluded === false ? "plus fees" : "fees not stated"}
                            {conv != null && <span suppressHydrationWarning title={`${FX_SOURCE.name}, ${FX_SOURCE.asOf}`}> · ≈ {formatMoney(Math.round(conv), user.prefs.currency)}</span>}
                          </span>
                        </>
                      ) : (
                        <span className="t-small text-text-3">Price not published</span>
                      )}
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      {o.purchaseUrl ? (
                        <a href={`/out/${encodeURIComponent(o.id)}`} target={o.isDemo ? undefined : "_blank"} rel="noopener noreferrer nofollow sponsored" className={`btn btn-sm w-full sm:w-auto ${o.availability === "sold_out" || inactive ? "btn-secondary" : "btn-primary"}`}>
                          {o.isDemo ? "View demo offer" : `Go to ${o.provider}`}
                          {!o.isDemo && <ExternalLink size={13} aria-hidden />}
                        </a>
                      ) : (
                        <span className="t-micro text-text-3">No link</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <p className="t-micro text-text-3 mt-3 flex gap-1.5">
        <Info size={13} className="shrink-0 mt-px" aria-hidden />
        You buy directly from the seller. Prices can change after the time shown.
      </p>
    </div>
  );
}

export function LocationMap({ lat, lng, label, group }: { lat: number; lng: number; label: string; group: string }) {
  const c: Cluster = { id: "venue", lat, lng, count: 1, groups: { [group]: 1 }, dominant: group, label, sample: [] as EventCard[] };
  return <ClusterMap className="h-64" clusters={[c]} initial={{ lat, lng, zoom: 15 }} onClusterClick={() => {}} />;
}
