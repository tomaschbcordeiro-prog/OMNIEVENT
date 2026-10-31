"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Ban, CalendarHeart, MessageCircle, UserCheck, UserPlus } from "lucide-react";
import { BADGES, KIND_META, type FeedItem, type PublicProfile, type TargetMeta } from "@/lib/community/types";
import { ago, communityGet, communityPost, useMe } from "@/lib/community/client";
import { formatEventDate } from "@/lib/format";
import { Poster } from "../ui";
import { Avatar, Burst, requireMember, Stars } from "./bits";
import { Reactions, RichText } from "./interact";
import { toast } from "../toast";

type Member = { profile: PublicProfile; posts: FeedItem[]; plans: TargetMeta[]; follow?: { followers: number; following: number; byViewer: boolean }; blockedByViewer?: boolean };

export function MemberPage({ id }: { id: string }) {
  const { profile: me } = useMe();
  const [m, setM] = useState<Member | null | undefined>(undefined);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    communityGet<Member>(`view=member&id=${encodeURIComponent(id)}`).then(setM, () => setM(null));
  }, [id, me?.karma, me?.name, me?.avatar, reload]);
  const block = async () => {
    if (!m || !(await requireMember())) return;
    const blocking = !m.blockedByViewer;
    if (blocking && !confirm(`Block ${m.profile.name}? You won't see their posts, and they can't reply to you, mention you, follow you or join your meet-ups.`)) return;
    try {
      await communityPost({ action: "block", member: m.profile.id });
      toast({ title: blocking ? `${m.profile.firstName ?? m.profile.name} is blocked` : "Unblocked", emoji: blocking ? "🚫" : "👌" });
      setReload((n) => n + 1);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Something went wrong", emoji: "⚠️" });
    }
  };

  if (m === undefined) return <main className="mx-auto max-w-[1000px] px-4 sm:px-6 pt-10"><div className="skeleton h-40" aria-hidden /></main>;
  if (m === null)
    return (
      <main className="mx-auto max-w-[1000px] px-4 sm:px-6 pt-16 text-center">
        <p className="t-h2">We couldn&apos;t find this member</p>
        <Link href="/community" className="btn btn-secondary mt-4">Back to the community</Link>
      </main>
    );
  const p = m.profile;
  const isMe = me?.id === p.id;
  const upcoming = m.plans.filter((t) => !t.start || Date.parse(t.start) > Date.now() - 24 * 3600000);
  return (
    <main className="mx-auto max-w-[1000px] px-4 sm:px-6 pt-8">
      <nav aria-label="Breadcrumb" className="t-small text-text-3 mb-4"><Link href="/community" className="inline-block py-1 hover:text-text">Community</Link></nav>
      <header className="surface rounded-[var(--radius-l)] p-5 sm:p-6 flex flex-wrap items-center gap-5 panel-in">
        <Avatar p={p} size={88} />
        <div className="min-w-0 flex-1">
          <h1 className="t-h1">{p.name}</h1>
          {p.username && <p className="t-body text-text-2">@{p.username}</p>}
          {p.bio && <p className="t-body text-text-2 mt-1">{p.bio}</p>}
          <p className="t-small text-text-3 mt-1">Member since {new Date(p.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>
          <div className="mt-3 flex flex-wrap gap-1">
            {p.badges.map((b) => <span key={b} title={BADGES[b]?.hint} className="rounded-full bg-sun/15 px-2 py-0.5 t-micro font-semibold">{BADGES[b]?.emoji} {BADGES[b]?.label}</span>)}
          </div>
        </div>
        <dl className="grid grid-cols-4 gap-2 text-center w-full sm:w-auto">
          {([["Followers", m.follow?.followers ?? 0], ["Following", m.follow?.following ?? 0], ["Points", p.karma], ["Posts", p.counts.posts]] as const).map(([k, v]) => (
            <div key={k} className="rounded-[var(--radius-m)] bg-panel-2 px-3 py-2">
              <dd className="t-h3 tnum">{v}</dd>
              <dt className="t-micro text-text-3">{k}</dt>
            </div>
          ))}
        </dl>
        {isMe ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void requireMember(true, true)}>Edit profile</button>
        ) : (
          <div className="flex flex-wrap gap-2">
            {!m.blockedByViewer && <FollowButton member={p} following={!!m.follow?.byViewer} onChange={(following, followers) => setM((x) => x && { ...x, follow: { following: x.follow?.following ?? 0, followers, byViewer: following } })} />}
            <button type="button" className={`btn btn-sm ${m.blockedByViewer ? "btn-secondary" : "btn-ghost text-text-3"}`} onClick={() => void block()}>
              <Ban size={15} aria-hidden /> {m.blockedByViewer ? "Unblock" : "Block"}
            </button>
          </div>
        )}
      </header>
      {m.blockedByViewer && (
        <p className="mt-4 rounded-[var(--radius-m)] border border-line bg-panel-2 p-3 t-small text-text-2">
          You blocked {p.firstName ?? p.name}. You don&apos;t see their posts, and they can&apos;t reply to you, mention you, follow you or join your meet-ups.
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-[1fr_300px]">
        <section aria-labelledby="posts-h">
          <h2 id="posts-h" className="t-h2 flex items-center gap-2"><MessageCircle size={18} className="text-cyan" aria-hidden />Posts</h2>
          {m.posts.length === 0 && <p className="t-small text-text-2 mt-2">{isMe ? "You haven't posted yet. Find an event and say hello!" : "No posts yet."}</p>}
          <ul className="mt-3 grid gap-3 stagger">
            {m.posts.map(({ post, meta }) => (
              <li key={post.id} className="surface rounded-[var(--radius-l)] p-4">
                <p className="t-small text-text-3">
                  {KIND_META[post.kind].emoji} {post.parent ? "Reply" : KIND_META[post.kind].label} on {meta ? <Link href={`${meta.href}#community`} className="font-semibold text-text hover:text-cyan">{meta.title}</Link> : "an event"} · {ago(post.createdAt)}
                </p>
                {post.rating && <Stars value={post.rating} size={14} className="mt-1.5" />}
                {post.text && <RichText text={post.text} className="t-body mt-1" />}
                <div className="mt-2"><Reactions post={post} me={me} size="sm" /></div>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="plans-h">
          <h2 id="plans-h" className="t-h3 flex items-center gap-2"><CalendarHeart size={18} className="text-sun" aria-hidden />Going to</h2>
          {upcoming.length === 0 && <p className="t-small text-text-2 mt-2">No plans shared yet.</p>}
          <ul className="mt-2 grid gap-1">
            {upcoming.map((t) => (
              <li key={t.target}>
                <Link href={t.href} className="press flex items-center gap-3 rounded-[var(--radius-m)] p-1.5 hover:bg-panel-2">
                  <Poster title={t.title} imageUrl={t.imageUrl} hue={t.hue} categorySlug={t.categorySlug ?? "other"} size="sm" className="h-11 w-11 rounded-[var(--radius-s)] shrink-0" />
                  <span className="min-w-0">
                    <span className="block t-small font-semibold truncate">{t.title}</span>
                    <span className="block t-micro text-text-3 truncate">{t.start ? formatEventDate(t.start, t.timeZone ?? "UTC") : t.sub}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function FollowButton({ member, following, onChange }: { member: PublicProfile; following: boolean; onChange: (following: boolean, followers: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(0);
  const click = async () => {
    if (!(await requireMember())) return;
    setBusy(true);
    try {
      const r = await communityPost<{ following: boolean; followers: number }>({ action: "follow", member: member.id });
      onChange(r.following, r.followers);
      if (r.following) {
        setBurst((n) => n + 1);
        toast({ emoji: member.avatar, title: `You follow ${member.firstName ?? member.name}`, body: "Their posts and plans now show under Following in the community." });
      }
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Something went wrong", emoji: "⚠️" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="relative">
      <button type="button" disabled={busy} aria-pressed={following} onClick={click} className={`btn btn-sm press ${following ? "btn-secondary" : "btn-primary"}`}>
        {following ? <UserCheck size={15} aria-hidden /> : <UserPlus size={15} aria-hidden />} {following ? "Following" : "Follow"}
      </button>
      {burst > 0 && <Burst key={burst} />}
    </span>
  );
}
