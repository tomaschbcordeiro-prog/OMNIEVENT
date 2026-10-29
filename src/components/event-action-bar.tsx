"use client";

import { useEffect, useState } from "react";
import { MessageCircle, Ticket } from "lucide-react";
import { Price, SaveButton } from "./ui";

/**
 * Phones: a bar fixed to the bottom of an event page once the visitor scrolls, so tickets,
 * saving and the conversation are always one tap away.
 */
export function EventActionBar({ id, title, isFree, fromPrice, hasOffers, officialUrl, inactive }: {
  id: string;
  title: string;
  isFree: boolean;
  fromPrice?: { amount: number; currency: string; feesIncluded?: boolean };
  hasOffers: boolean;
  officialUrl?: string;
  inactive?: boolean;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const on = () => setShown(window.scrollY > 320);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
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
        <SaveButton id={id} title={title} compact className="btn-secondary" />
        <a href="#community" className="btn btn-secondary btn-sm btn-icon press" aria-label="Community: who's going, questions and tips" tabIndex={shown ? 0 : -1}>
          <MessageCircle size={16} aria-hidden />
        </a>
        {primary && (
          <a href={primary.href} {...(primary.external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className={`btn btn-sm press ${inactive ? "btn-secondary" : "btn-primary"}`} tabIndex={shown ? 0 : -1}>
            <Ticket size={15} aria-hidden /> {primary.label}
          </a>
        )}
      </div>
    </div>
  );
}
