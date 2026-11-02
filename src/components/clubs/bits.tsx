"use client";

import Link from "next/link";
import { Lock, MapPin, Users } from "lucide-react";
import type { Club, ClubCard, ClubRole } from "@/lib/community/types";
import { GROUPS } from "@/lib/categories";
import { Avatar } from "../community/bits";

/** A club's two colours: deep enough for white text, from its hue. */
export const clubGradient = (hue: number, angle = 135) => `linear-gradient(${angle}deg, hsl(${hue} 72% 34%), hsl(${(hue + 45) % 360} 78% 46%))`;

export const ROLE_LABEL: Record<ClubRole, { label: string; emoji: string }> = {
  owner: { label: "Owner", emoji: "👑" },
  admin: { label: "Admin", emoji: "⭐" },
  member: { label: "Member", emoji: "✓" },
};

const GROUP_EMOJI: Record<string, string> = {
  music: "🎶", sports: "⚽", theatre: "🎭", comedy: "😂", festivals: "🎉", cinema: "🎬", conferences: "🎤", technology: "💻",
  exhibitions: "🎨", attractions: "🎡", "food-drink": "🍷", nightlife: "🪩", family: "🧸", outdoor: "🥾", education: "📚", fashion: "👗", culture: "🏛️", other: "✨",
};
export const vibeEmoji = (g: string) => GROUP_EMOJI[g] ?? "✨";
export const vibeLabel = (g: string) => GROUPS.find((x) => x.slug === g)?.name.split(" & ")[0] ?? g;

/** The club's crest: its emoji on its colours, with a gold rim. */
export function ClubCrest({ club, size = 64, className = "" }: { club: Pick<Club, "emoji" | "hue">; size?: number; className?: string }) {
  return (
    <span
      className={`club-shine grid place-items-center rounded-[28%] shrink-0 ${className}`}
      style={{ width: size, height: size, background: clubGradient(club.hue), boxShadow: "0 0 0 2px var(--gold), 0 10px 24px -10px rgb(23 11 46 / 0.7)", fontSize: size * 0.5 }}
      aria-hidden
    >
      {club.emoji}
    </span>
  );
}

export function RoleBadge({ role, className = "" }: { role: ClubRole; className?: string }) {
  const r = ROLE_LABEL[role];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 t-micro font-bold ${role === "owner" ? "bg-[var(--club-deep)] text-[var(--gold-light)]" : role === "admin" ? "bg-sun/20 text-text" : "bg-ok/10 text-ok"} ${className}`}>
      <span aria-hidden>{r.emoji}</span> {role === "member" ? "Member" : r.label}
    </span>
  );
}

/** A club in a grid: banner, crest, name, tagline, faces and counts. */
export function ClubTile({ club }: { club: ClubCard }) {
  return (
    <li className="club-card min-w-0">
      <Link href={`/clubs/${club.slug}`} className="block h-full overflow-hidden rounded-[var(--radius-l)] border border-line bg-panel">
        <div className="club-shine relative h-20" style={{ background: clubGradient(club.hue, 120) }}>
          <span className="absolute inset-0 opacity-25" style={{ backgroundImage: "radial-gradient(rgb(255 255 255 / 0.5) 1px, transparent 1px)", backgroundSize: "14px 14px" }} aria-hidden />
          {club.myRole ? <RoleBadge role={club.myRole} className="absolute right-2.5 top-2.5" /> : club.requested ? <span className="absolute right-2.5 top-2.5 rounded-full bg-black/35 px-2 py-0.5 t-micro font-semibold text-white">Request sent</span> : null}
        </div>
        <div className="px-4 pb-4">
          <ClubCrest club={club} size={56} className="-mt-7 relative" />
          <p className="mt-2 font-bold text-[1.05rem] leading-tight line-clamp-1">{club.name}</p>
          <p className="t-small text-text-2 mt-0.5 line-clamp-2 min-h-[2.6em]">{club.tagline}</p>
          <div className="mt-2.5 flex flex-wrap gap-1">
            {club.vibes.slice(0, 3).map((v) => (
              <span key={v} className="rounded-full bg-panel-2 px-2 py-0.5 t-micro text-text-2">{vibeEmoji(v)} {vibeLabel(v)}</span>
            ))}
            {club.city && <span className="inline-flex items-center gap-0.5 rounded-full bg-panel-2 px-2 py-0.5 t-micro text-text-2"><MapPin size={11} aria-hidden /> {club.city}</span>}
            {club.privacy === "request" && <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--club-deep)]/10 px-2 py-0.5 t-micro text-[var(--club-deep)]"><Lock size={11} aria-hidden /> By request</span>}
          </div>
          <div className="mt-3 flex items-center gap-2">
            {club.faces.length > 0 && (
              <span className="avatar-stack flex">
                {club.faces.slice(0, 4).map((p) => <Avatar key={p.id} p={p} size={24} />)}
              </span>
            )}
            <span className="t-micro text-text-3 tnum inline-flex items-center gap-1"><Users size={12} aria-hidden /> {club.members} {club.members === 1 ? "member" : "members"}{club.picks ? ` · ${club.picks} picks` : ""}</span>
          </div>
        </div>
      </Link>
    </li>
  );
}
