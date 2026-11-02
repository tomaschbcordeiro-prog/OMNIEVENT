"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Crown, Plus, Search, Sparkles } from "lucide-react";
import type { ClubCard, ClubDirectory } from "@/lib/community/types";
import { GROUPS } from "@/lib/categories";
import { clubsGet, useMe } from "@/lib/community/client";
import { requireMember } from "../community/bits";
import { ClubTile, vibeEmoji, vibeLabel } from "./bits";

/** Ideas to start from: each opens the founding form filled in. */
const IDEAS = [
  { name: "Lisbon Jazz Nights", emoji: "🎷", hue: "270", vibes: "music,nightlife", city: "lisbon", tagline: "Small clubs, big solos, every week" },
  { name: "Sunday Football Crew", emoji: "⚽", hue: "140", vibes: "sports", city: "", tagline: "Matches, pubs and the odd stadium trip" },
  { name: "Indie Film Club", emoji: "🎬", hue: "20", vibes: "cinema,culture", city: "", tagline: "Premieres, festivals and late-night screenings" },
  { name: "Museum Hoppers", emoji: "🎨", hue: "200", vibes: "exhibitions,culture", city: "", tagline: "One new exhibition a week, coffee after" },
];

const VIBE_FILTERS = ["music", "theatre", "comedy", "sports", "cinema", "exhibitions", "nightlife", "food-drink", "festivals", "outdoor"].filter((g) => GROUPS.some((x) => x.slug === g));

export function ClubsHome() {
  const { profile } = useMe();
  const router = useRouter();
  const [dir, setDir] = useState<ClubDirectory | null>(null);
  const [failed, setFailed] = useState("");
  const [q, setQ] = useState("");
  const [vibe, setVibe] = useState("");

  useEffect(() => {
    clubsGet<ClubDirectory>().then(
      (d) => (setDir(d), setFailed("")),
      (e) => setFailed(e instanceof Error ? e.message : "Couldn't load the clubs."),
    );
  }, [profile?.id]);

  const found = async () => {
    if (await requireMember(false)) router.push("/clubs/new");
  };

  const match = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (c: ClubCard) => {
      if (vibe && !c.vibes.includes(vibe)) return false;
      const text = `${c.name} ${c.tagline} ${c.tags.join(" ")} ${c.city ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    };
  }, [q, vibe]);
  const mine = (dir?.mine ?? []).filter(match);
  const mineIds = new Set(mine.map((c) => c.id));
  const popular = (dir?.popular ?? []).filter((c) => match(c) && !mineIds.has(c.id));
  const fresh = (dir?.fresh ?? []).filter((c) => match(c) && !mineIds.has(c.id) && !popular.slice(0, 9).some((p) => p.id === c.id));
  const filtering = !!(q || vibe);
  const empty = dir && dir.total === 0;

  return (
    <main id="main">
      <section className="club-hero">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-12 sm:py-16 grid gap-10 lg:grid-cols-[1.2fr_1fr] items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-[var(--gold)]/50 bg-white/10 px-3 py-1 t-small font-semibold text-[var(--gold-light)]">
              <span className="nav-premium-star !text-[var(--gold-light)]" aria-hidden>✦</span> New · Clubs
            </p>
            <h1 className="t-display mt-4 text-balance">
              Find your people.<br />
              <span className="gold-text">Go together.</span>
            </h1>
            <p className="t-lede text-white/85 mt-4 measure">
              Clubs are small circles of people who love the same things: jazz nights, football Sundays, indie films, museum hopping. Found one, invite your friends, share events and vote on what to see next.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-gold press" onClick={() => void found()}>
                <Crown size={17} aria-hidden /> Found a club
              </button>
              <a href="#directory" className="btn press border border-white/30 bg-white/10 text-white hover:bg-white/15">Browse clubs</a>
              {dir && dir.total > 0 && <span className="t-small text-white/75 tnum">{dir.total} {dir.total === 1 ? "club" : "clubs"} so far</span>}
            </div>
          </div>
          <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {[
              ["👑", "Run it your way", "Owners pick admins, approve who joins and keep the wall friendly."],
              ["🎟️", "Share events, vote together", "Members share what's on and vote for the ones to go to as a group."],
              ["💬", "A wall for members", "Chat, plan meet-ups and swap tips, just within the club."],
            ].map(([emoji, title, body]) => (
              <li key={title} className="rounded-[var(--radius-l)] border border-white/15 bg-white/[0.07] p-4 backdrop-blur">
                <p className="font-semibold"><span aria-hidden className="mr-1.5">{emoji}</span>{title}</p>
                <p className="t-small text-white/75 mt-1">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="directory" aria-labelledby="dir-h" className="mx-auto max-w-[1400px] px-4 sm:px-6 py-10 scroll-mt-24">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="dir-h" className="t-h2">Clubs</h2>
          <button type="button" className="btn btn-secondary btn-sm press" onClick={() => void found()}><Plus size={15} aria-hidden /> New club</button>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative sm:w-80">
            <span className="sr-only">Search clubs</span>
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" aria-hidden />
            <input className="field w-full pl-9" placeholder="Search by name, taste or city" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1" role="group" aria-label="Filter by vibe">
            <button type="button" aria-pressed={!vibe} className={`chip shrink-0 ${!vibe ? "!bg-text !text-white !border-text" : ""}`} onClick={() => setVibe("")}>All</button>
            {VIBE_FILTERS.map((g) => (
              <button key={g} type="button" aria-pressed={vibe === g} className={`chip shrink-0 ${vibe === g ? "!bg-text !text-white !border-text" : ""}`} onClick={() => setVibe(vibe === g ? "" : g)}>
                <span aria-hidden>{vibeEmoji(g)}</span> {vibeLabel(g)}
              </button>
            ))}
          </div>
        </div>

        {failed && <p role="alert" className="mt-6 rounded-[var(--radius-m)] border border-bad/30 bg-bad/5 p-4 t-small">{failed}</p>}
        {!dir && !failed && <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-hidden>{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-64 rounded-[var(--radius-l)]" />)}</div>}

        {empty && (
          <div className="mt-6 rounded-[var(--radius-l)] border border-dashed border-line-strong p-6 sm:p-8">
            <Sparkles size={24} className="text-sun" aria-hidden />
            <p className="t-h3 mt-2">No clubs yet. Found the first one!</p>
            <p className="t-small text-text-2 mt-1">Start from an idea, or make your own.</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {IDEAS.map((i) => (
                <li key={i.name}>
                  <Link href={`/clubs/new?${new URLSearchParams(i).toString()}`} className="chip press hover:border-[var(--gold)]">
                    <span aria-hidden>{i.emoji}</span> {i.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {dir && !empty && (
          <>
            <Shelf title="Your clubs" items={mine} />
            <Shelf title={filtering ? "Matching clubs" : "Most members"} items={popular} empty={filtering && !mine.length ? "No club matches. Try another word or vibe, or found one." : undefined} />
            {!filtering && <Shelf title="Newest" items={fresh} />}
          </>
        )}
      </section>
    </main>
  );
}

function Shelf({ title, items, empty }: { title: string; items: ClubCard[]; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <section className="mt-8" aria-label={title}>
      <h3 className="t-h3">{title}</h3>
      {items.length ? (
        <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 stagger">
          {items.map((c) => <ClubTile key={c.id} club={c} />)}
        </ul>
      ) : (
        <p className="t-small text-text-2 mt-2">{empty}</p>
      )}
    </section>
  );
}
