"use client";

import { useEffect, useState } from "react";
import { Share2, Ticket } from "lucide-react";
import { Price, SaveButton } from "./ui";
import type { SavedSnap } from "@/lib/user/store";
import type { TripEvent } from "@/lib/trip-snap";
import { TripButton } from "./trips/trip-add";
import { toast } from "./toast";

/**
 * Phones: a bar fixed to the bottom of an event page, so tickets, saving and the trip are
 * always one tap away (however far down the page is read).
 */
export function EventActionBar({ id, title, isFree, fromPrice, hasOffers, officialUrl, inactive, snap, tripEvent }: {
  id: string;
  title: string;
  snap?: SavedSnap;
  tripEvent?: TripEvent;
  isFree: boolean;
  fromPrice?: { amount: number; currency: string; feesIncluded?: boolean };
  hasOffers: boolean;
  officialUrl?: string;
  inactive?: boolean;
}) {
  // In from the start (slid up once the page is in): tickets are the main way on.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 350);
    return () => window.clearTimeout(t);
  }, []);
  const primary = !isFree && hasOffers ? { href: "#tickets", label: "Tickets", external: false } : officialUrl ? { href: officialUrl, label: isFree ? "Details" : "Tickets", external: true } : null;
  return (
    <div className={`action-bar lg:hidden ${shown ? "is-shown" : ""}`} aria-hidden={!shown} inert={!shown}>
      <div className="flex items-center gap-2 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="t-micro text-text-3 truncate">{title}</p>
          <p className="font-semibold leading-tight">
            <Price amount={fromPrice?.amount} currency={fromPrice?.currency} feesIncluded={fromPrice?.feesIncluded} isFree={isFree} />
          </p>
        </div>
        {tripEvent && <TripButton event={tripEvent} title={title} className="btn-secondary" />}
        <SaveButton id={id} title={title} compact className="btn-secondary" snap={snap} />
        <button
          type="button"
          className="btn btn-secondary btn-sm btn-icon press"
          aria-label={`Share ${title}`}
          tabIndex={shown ? 0 : -1}
          onClick={async () => {
            const url = window.location.href.split("#")[0];
            try {
              if (navigator.share) await navigator.share({ title, url });
              else {
                await navigator.clipboard.writeText(url);
                toast({ title: "Link copied", body: title, emoji: "🔗" });
              }
            } catch {
              // the share sheet was closed
            }
          }}
        >
          <Share2 size={16} aria-hidden />
        </button>
        {primary && (
          <a href={primary.href} {...(primary.external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className={`btn btn-sm press ${inactive ? "btn-secondary" : "btn-primary"}`} tabIndex={shown ? 0 : -1}>
            <Ticket size={15} aria-hidden /> {primary.label}
          </a>
        )}
      </div>
    </div>
  );
}
