"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Flame, Heart, MessageCircle, Sparkles, Star, Trophy, Users } from "lucide-react";
import type { EventCard } from "@/lib/types";
import { BADGES, KIND_META, type CommunityHome as Home, type FeedItem, type PostKind, type PublicProfile, type TargetMeta } from "@/lib/community/types";
import { ago, communityGet, communityPost, useMe } from "@/lib/community/client";
import { formatEventDate } from "@/lib/format";
import { Poster } from "../ui";
import { Avatar, MemberName, requireMember, Stars } from "./bits";

type Filter = "all" | PostKind;
const FILTERS: Filter[] = ["all", "review", "question", "tip", "meetup", "comment"];

/** Points needed for each next badge, shown as progress on the member card. */
const NEXT: { badge: string; need: (p: PublicProfile) => [number, number] }[] = [
  { badge: "voice", need: (p) => [p.counts.posts, 1] },
  { badge: "regular", need: (p) => [p.counts.going, 5] },
  { badge: "critic", need: (p) => [p.counts.reviews, 5] },
  { badge: "helper", need: (p) => [p.counts.likes, 10] },
  { badge: "storyteller", need: (p) => [p.counts.posts, 25] },
  { badge: "legend", need: (p) => [p.karma, 250] },
];

export function CommunityHome({ starters }: { starters: EventCard[] }) {
  const { profile } = useMe();
  const [home, setHome] = useState<Home | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const h = await communityGet<Home>("view=home");
      const ids = new Set(h.feed.map((f) => f.post.id));
      if (seen.current) setFresh(new Set([...ids].filter((id) => !seen.current!.has(id))));
      seen.current = ids;
      setHome(h);
    } catch {
      setHome((h) => h ?? { stats: { members: 0, posts: 0, ratings: 0, plans: 0 }, feed: [], trending: [], topRated: [], leaders: [], profiles: {}, persistent: true });
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => document.visibilityState === "visible" && void load(), 15000);
    return () => clearInterval(id);
  }, [load, profile?.id]);

  const feed = (home?.feed ?? []).filter((f) => filter === "all" || f.post.kind === filter);
  const quiet = home && home.feed.length === 0;

  return (
    <main>
      <section className="sky relative overflow-hidden">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-10 pb-12 grid gap-8 lg:grid-cols-[1.3fr_1fr] items-center">
          <div className="on-sky">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 t-small font-semibold text-text shadow-sm">
              <span className="live-dot" aria-hidden /> Live community
            </p>
            <h1 className="t-display mt-4 text-white text-balance drop-shadow-[0_2px_12px_rgb(10_50_120_/_0.35)]">The people behind every pin on the map</h1>
            <p className="t-body text-text font-medium mt-3 measure">Rate venues and shows, ask before you go, share tips, and find people heading to the same event.</p>
            <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-xl">
              {([
                ["Members", home?.stats.members],
                ["Posts", home?.stats.posts],
                ["Ratings", home?.stats.ratings],
                ["Plans made", home?.stats.plans],
              ] as const).map(([k, v]) => (
                <div key={k} className="rounded-[var(--radius-m)] bg-white/85 backdrop-blur px-3 py-2.5 shadow-sm">
                  <dd className="text-2xl font-bold tnum text-text">{v ?? <span className="skeleton inline-block h-6 w-10" />}</dd>
                  <dt className="t-micro text-text-2">{k}</dt>
                </div>
              ))}
            </dl>
          </div>
          <MemberCard profile={profile} />
        </div>
      </section>

      {home && !home.persistent && (
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 mt-4">
          <p className="rounded-[var(--radius-m)] border border-warn/30 bg-warn/5 p-3 t-small text-text-2">Community storage isn&apos;t connected yet, so posts are kept only temporarily on this server.</p>
        </div>
      )}

      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_380px]">
        <section aria-labelledby="feed-h" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="feed-h" className="t-h2 flex items-center gap-2"><MessageCircle size={20} className="text-cyan" aria-hidden />What people are saying</h2>
          </div>
          <div className="mt-3 flex gap-1.5 overflow-x-auto no-scrollbar pb-1" role="tablist" aria-label="Filter posts">
            {FILTERS.map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`chip press shrink-0 ${filter === f ? "!bg-text !text-white !border-text" : ""}`}>
                {f === "all" ? "Everything" : `${KIND_META[f].emoji} ${KIND_META[f].label}`}
              </button>
            ))}
          </div>

          {!home && <div className="mt-4 grid gap-3" aria-hidden>{[0, 1, 2].map((i) => <div key={i} className="skeleton h-28" />)}</div>}

          {quiet && (
            <div className="mt-4 rounded-[var(--radius-l)] border border-dashed border-line-strong p-6">
              <Sparkles size={24} className="text-sun" aria-hidden />
              <p className="t-h3 mt-2">It&apos;s quiet here. Start something!</p>
              <p className="t-small text-text-2 mt-1">Open an event you&apos;re curious about and say you&apos;re going, ask a question, or rate a venue you know.</p>
              {starters.length > 0 && (
                <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 stagger">
                  {starters.map((c) => (
                    <li key={c.id} className="min-w-0">
                      <Link href={`/events/${c.slug}#community`} className="press group flex gap-3 rounded-[var(--radius-m)] border border-line bg-panel p-2.5 hover:border-cyan/40">
                        <Poster title={c.title} imageUrl={c.imageUrl} hue={c.posterHue} categorySlug={c.categorySlug} size="sm" className="h-16 w-16 rounded-[var(--radius-s)] shrink-0" />
                        <span className="min-w-0">
                          <span className="block font-semibold truncate group-hover:text-cyan">{c.title}</span>
                          <span className="block t-micro text-text-3 truncate">{c.venueName}, {c.city}</span>
                          <span className="block t-micro text-cyan mt-1">Be the first to say hi →</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {home && !quiet && feed.length === 0 && <p className="mt-4 t-small text-text-2">Nothing of this kind yet.</p>}

          <ul className="mt-4 grid gap-3">
            {feed.map((f) => <FeedCard key={f.post.id} item={f} author={home!.profiles[f.post.author]} fresh={fresh.has(f.post.id)} me={profile} />)}
          </ul>
        </section>

        <aside className="grid gap-6 self-start lg:sticky lg:top-[calc(var(--header-h)+1.5rem)]">
          <SideList icon={<Flame size={18} className="text-coral" aria-hidden />} title="Trending this week" empty="Plans and posts this week will show up here." items={home?.trending} render={(t) => (
            <>
              <span className="t-micro text-text-3 tnum flex gap-2">
                {t.going > 0 && <span>🎟️ {t.going} going</span>}
                {t.interested > 0 && <span>⭐ {t.interested} interested</span>}
                {t.posts > 0 && <span>💬 {t.posts}</span>}
              </span>
            </>
          )} />
          <SideList icon={<Star size={18} className="text-sun" fill="currentColor" strokeWidth={0} aria-hidden />} title="Best rated" empty="Rate a venue or a show to start the ranking." items={home?.topRated} render={(t) => (
            <span className="flex items-center gap-1.5 t-micro text-text-3 tnum"><Stars value={t.ratingAvg} size={12} /> {t.ratingAvg.toFixed(1)} · {t.ratingCount} {t.ratingCount === 1 ? "rating" : "ratings"}</span>
          )} />
          <section aria-labelledby="lead-h" className="surface rounded-[var(--radius-l)] p-4">
            <h2 id="lead-h" className="t-h3 flex items-center gap-2"><Trophy size={18} className="text-amber" aria-hidden />Top members</h2>
            {home && home.leaders.length === 0 && <p className="t-small text-text-2 mt-2">Join and post to appear here.</p>}
            <ol className="mt-2 grid gap-1">
              {(home?.leaders ?? []).map((p, i) => (
                <li key={p.id} className={`flex items-center gap-2.5 rounded-[var(--radius-s)] px-1.5 py-1.5 ${p.id === profile?.id ? "bg-sun/15" : ""}`}>
                  <span className={`w-5 text-center t-small font-bold tnum ${i < 3 ? "text-amber" : "text-text-3"}`}>{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>
                  <Avatar p={p} size={28} />
                  <MemberName p={p} className="t-small truncate" />
                  <span className="ml-auto t-micro text-text-3 tnum">{p.karma} pts</span>
                </li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="badge-h" className="rounded-[var(--radius-l)] border border-line p-4">
            <h2 id="badge-h" className="t-h3">Badges to earn</h2>
            <ul className="mt-2 grid grid-cols-2 gap-2">
              {Object.entries(BADGES).map(([id, b]) => {
                const have = profile?.badges.includes(id);
                return (
                  <li key={id} className={`rounded-[var(--radius-m)] border p-2 ${have ? "border-sun/50 bg-sun/10" : "border-line opacity-80"}`} title={b.hint}>
                    <span className={`text-lg ${have ? "" : "grayscale"}`} aria-hidden>{b.emoji}</span>
                    <p className="t-small font-semibold leading-tight">{b.label}</p>
                    <p className="t-micro text-text-3 leading-tight">{b.hint}</p>
                  </li>
                );
              })}
            </ul>
            <p className="t-micro text-text-3 mt-3">Points: posts 5, reviews 10, plans 1, each like you get 2.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}

function MemberCard({ profile }: { profile: PublicProfile | null }) {
  if (!profile)
    return (
      <div className="surface-float rounded-[var(--radius-l)] p-5 panel-in">
        <div className="flex -space-x-2" aria-hidden>
          {["🦊", "🐙", "🎸", "⚽", "🎭"].map((a, i) => <Avatar key={a} p={{ avatar: a, hue: [210, 330, 28, 95, 265][i], name: "" }} size={40} />)}
        </div>
        <p className="t-h3 mt-3">Join in seconds</p>
        <p className="t-small text-text-2 mt-1">Pick a name and an avatar. No email, no password.</p>
        <button type="button" className="btn btn-primary mt-4 w-full press" onClick={() => void requireMember(false)}>
          <Users size={16} aria-hidden /> Join the community
        </button>
      </div>
    );
  const next = NEXT.find((n) => !profile.badges.includes(n.badge));
  const [have, need] = next ? next.need(profile) : [1, 1];
  return (
    <div className="surface-float rounded-[var(--radius-l)] p-5 panel-in">
      <div className="flex items-center gap-3">
        <Avatar p={profile} size={56} />
        <div className="min-w-0">
          <p className="t-h3 truncate">{profile.name}</p>
          <p className="t-small text-text-2 tnum">{profile.karma} {profile.karma === 1 ? "point" : "points"} · {profile.badges.length} {profile.badges.length === 1 ? "badge" : "badges"}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => void requireMember(true, true)}>Edit</button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {profile.badges.map((b) => <span key={b} title={BADGES[b]?.hint} className="rounded-full bg-sun/15 px-2 py-0.5 t-micro font-semibold">{BADGES[b]?.emoji} {BADGES[b]?.label}</span>)}
      </div>
      {next && (
        <div className="mt-4">
          <p className="t-micro text-text-3">Next badge: {BADGES[next.badge].emoji} {BADGES[next.badge].label} ({BADGES[next.badge].hint.toLowerCase()})</p>
          <div className="mt-1 h-2 rounded-full bg-panel-2 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan to-sun transition-[width] duration-700" style={{ width: `${Math.min(100, (have / need) * 100)}%` }} />
          </div>
        </div>
      )}
      <Link href={`/community/u/${profile.id}`} className="btn btn-secondary btn-sm mt-4 w-full">Your profile and activity</Link>
    </div>
  );
}

function SideList({ icon, title, items, empty, render }: { icon: React.ReactNode; title: string; items?: (TargetMeta & { going: number; interested: number; posts: number; ratingAvg: number; ratingCount: number })[]; empty: string; render: (t: NonNullable<typeof items>[number]) => React.ReactNode }) {
  return (
    <section className="surface rounded-[var(--radius-l)] p-4" aria-label={title}>
      <h2 className="t-h3 flex items-center gap-2">{icon}{title}</h2>
      {items && items.length === 0 && <p className="t-small text-text-2 mt-2">{empty}</p>}
      {!items && <div className="skeleton h-24 mt-3" aria-hidden />}
      <ul className="mt-2 grid gap-1">
        {(items ?? []).slice(0, 8).map((t) => (
          <li key={t.target}>
            <Link href={t.href} className="press flex items-center gap-3 rounded-[var(--radius-m)] p-1.5 hover:bg-panel-2">
              <Poster title={t.title} imageUrl={t.imageUrl} hue={t.hue} categorySlug={t.categorySlug ?? "other"} size="sm" className="h-11 w-11 rounded-[var(--radius-s)] shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block t-small font-semibold truncate">{t.title}</span>
                <span className="block t-micro text-text-3 truncate">{[t.sub, t.start ? formatEventDate(t.start, t.timeZone ?? "UTC") : ""].filter(Boolean).join(" · ")}</span>
                {render(t)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FeedCard({ item, author, fresh, me }: { item: FeedItem; author?: PublicProfile; fresh: boolean; me: PublicProfile | null }) {
  const { post, meta } = item;
  const [liked, setLiked] = useState(!!post.liked);
  const [likes, setLikes] = useState(post.likes ?? 0);
  const like = async () => {
    if (!(await requireMember(!!me))) return;
    setLiked(!liked);
    setLikes((n) => n + (liked ? -1 : 1));
    try {
      const r = await communityPost<{ liked: boolean; likes: number }>({ action: "like", post: post.id });
      setLiked(r.liked);
      setLikes(r.likes);
    } catch {
      setLiked(liked);
      setLikes(post.likes ?? 0);
    }
  };
  return (
    <li className={`surface rounded-[var(--radius-l)] p-4 panel-in ${fresh ? "flash-new" : ""}`}>
      <div className="flex gap-3">
        <Avatar p={author} size={38} />
        <div className="min-w-0 flex-1">
          <p className="t-small flex flex-wrap items-center gap-x-1.5">
            <MemberName p={author} />
            <span className="text-text-3">{post.parent ? "replied on" : post.kind === "review" ? "reviewed" : post.kind === "question" ? "asked about" : post.kind === "tip" ? "shared a tip on" : post.kind === "meetup" ? "suggested meeting at" : "posted on"}</span>
            {meta ? <Link href={`${meta.href}#community`} className="font-semibold hover:text-cyan truncate max-w-full">{meta.title}</Link> : <span className="text-text-3">an event</span>}
          </p>
          {meta?.sub && <p className="t-micro text-text-3 truncate">{meta.sub}{meta.start ? ` · ${formatEventDate(meta.start, meta.timeZone ?? "UTC")}` : ""}</p>}
          {post.rating && <Stars value={post.rating} size={14} className="mt-1.5" />}
          {post.text && <p className="t-body mt-1.5 whitespace-pre-line break-words line-clamp-6">{post.text}</p>}
          <div className="mt-2 flex items-center gap-3 t-micro text-text-3">
            <span>{ago(post.createdAt)}</span>
            <button type="button" onClick={like} aria-pressed={liked} aria-label={liked ? "Unlike" : "Like"} className={`inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-panel-2 ${liked ? "text-coral" : ""}`}>
              <Heart key={String(liked)} size={14} fill={liked ? "currentColor" : "none"} className={liked ? "pop" : ""} aria-hidden /> <span className="tnum">{likes || ""}</span>
            </button>
            {meta && <Link href={`${meta.href}#community`} className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-panel-2"><MessageCircle size={14} aria-hidden /> Reply</Link>}
          </div>
        </div>
      </div>
    </li>
  );
}
