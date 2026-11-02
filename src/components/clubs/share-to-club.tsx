"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import type { ClubCard, ClubPick } from "@/lib/community/types";
import { clubsGet, clubsPost, useMe } from "@/lib/community/client";
import { toast } from "../toast";
import { ClubCrest } from "./bits";

/** "Share with a club" on an event page: a menu of the viewer's clubs. */
export function ShareToClub({ eventId, title }: { eventId: string; title: string }) {
  const { profile } = useMe();
  const [open, setOpen] = useState(false);
  const [clubs, setClubs] = useState<ClubCard[] | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !clubs) clubsGet<{ clubs: ClubCard[] }>("view=mine").then((r) => setClubs(r.clubs), () => setClubs([]));
  };
  const share = async (c: ClubCard) => {
    setBusy(c.id);
    try {
      const r = await clubsPost<{ pick: ClubPick }>({ action: "pick", club: c.id, event: eventId });
      setDone((d) => new Set(d).add(c.id));
      toast({ title: `Shared with ${c.name}`, emoji: c.emoji, body: r.pick.votes > 1 ? `${r.pick.votes} members would go` : "Members can vote to go together.", href: `/clubs/${c.slug}`, linkLabel: "Open the club" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Something went wrong", emoji: "⚠️" });
    } finally {
      setBusy("");
    }
  };

  if (!profile?.username) return null;
  return (
    <div className="relative">
      <button type="button" className="btn btn-secondary btn-sm" aria-expanded={open} aria-haspopup="menu" onClick={() => void toggle()}>
        <span className="nav-premium-star" aria-hidden>✦</span> Share with a club
      </button>
      {open && (
        <div role="menu" aria-label={`Share ${title} with a club`} className="absolute z-30 mt-1.5 w-72 surface-float rounded-[var(--radius-m)] p-2 panel-in" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          {!clubs && <div className="skeleton h-12" aria-hidden />}
          {clubs && clubs.length === 0 && (
            <p className="t-small text-text-2 p-2">
              You&apos;re not in a club yet. <Link href="/clubs" className="font-semibold text-cyan hover:underline">Find or found one</Link>.
            </p>
          )}
          {clubs && clubs.length > 0 && (
            <ul className="grid gap-1">
              {clubs.map((c) => (
                <li key={c.id}>
                  <button role="menuitem" type="button" disabled={!!busy || done.has(c.id)} onClick={() => void share(c)} className="w-full flex items-center gap-2.5 rounded px-2 py-1.5 text-left hover:bg-panel-2 disabled:opacity-70">
                    <ClubCrest club={c} size={30} />
                    <span className="min-w-0 flex-1 t-small font-semibold truncate">{c.name}</span>
                    {done.has(c.id) && <Check size={15} className="text-ok" aria-label="Shared" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
