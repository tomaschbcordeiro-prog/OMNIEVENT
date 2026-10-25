"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, MessageCircle, MoreHorizontal, Send, ShieldAlert, Sparkles, Star, Users } from "lucide-react";
import { KIND_META, type Post, type PostKind, type PublicProfile, type Thread } from "@/lib/community/types";
import { ago, communityGet, communityPost, CommunityRequestError, refreshMe, useMe } from "@/lib/community/client";
import { Avatar, Burst, MemberName, requireMember, StarInput, Stars } from "./bits";

export type PanelMode = "event-upcoming" | "event-past" | "place" | "person" | "city";

const KINDS: Record<PanelMode, PostKind[]> = {
  "event-upcoming": ["comment", "question", "tip", "meetup"],
  "event-past": ["review", "comment", "tip"],
  place: ["review", "tip", "question", "comment"],
  person: ["review", "comment", "question"],
  city: ["comment", "tip", "question", "meetup"],
};

const INTRO: Record<PanelMode, string> = {
  "event-upcoming": "See who's going, ask questions and plan to meet up.",
  "event-past": "Were you there? Rate it and tell others how it was.",
  place: "Rate this venue and share tips: entrances, seats, food, getting there.",
  person: "Fans rate and talk about this performer or team.",
  city: "Locals and visitors swap tips about what's on here.",
};

type Sort = "top" | "new";

export function CommunityPanel({ target, mode, title }: { target: string; mode: PanelMode; title: string }) {
  const { profile } = useMe();
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<Sort>("top");
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const t = await communityGet<Thread>(`view=thread&target=${encodeURIComponent(target)}`);
      const ids = new Set(t.posts.flatMap((p) => [p.id, ...(p.replies ?? []).map((r) => r.id)]));
      if (seen.current) {
        const added = [...ids].filter((id) => !seen.current!.has(id));
        if (added.length) setFresh(new Set(added));
      }
      seen.current = ids;
      setThread(t);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the conversation.");
    }
  }, [target]);

  // Reload when the member changes (to show their likes and plans), and every 20 s while visible.
  useEffect(() => {
    void load();
    const id = setInterval(() => document.visibilityState === "visible" && void load(), 20000);
    return () => clearInterval(id);
  }, [load, profile?.id]);

  const act = async (body: Record<string, unknown>) => {
    if (!(await requireMember(!!profile))) return false;
    try {
      await communityPost({ target, ...body });
      void refreshMe();
      return true;
    } catch (err) {
      setError(err instanceof CommunityRequestError ? err.message : "Something went wrong.");
      if (err instanceof CommunityRequestError && err.status === 401) await requireMember(false);
      return false;
    }
  };

  const posts = thread ? sortPosts(thread.posts, sort) : [];
  const isEvent = mode === "event-upcoming" || mode === "event-past";
  const canRate = mode !== "event-upcoming" && mode !== "city";

  return (
    <section id="community" aria-labelledby="community-h" className="mt-12 scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="community-h" className="t-h2 flex items-center gap-2">
            <Users size={20} className="text-cyan" aria-hidden />
            Community
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 px-2 py-0.5 text-[11px] font-semibold text-ok">
              <span className="live-dot" aria-hidden /> Live
            </span>
          </h2>
          <p className="t-small text-text-2 mt-1">{INTRO[mode]}</p>
        </div>
        {thread && thread.summary.posts > 0 && <p className="t-small text-text-3 tnum">{thread.summary.posts} {thread.summary.posts === 1 ? "post" : "posts"}</p>}
      </div>

      {thread && !thread.persistent && (
        <p className="mt-3 rounded-[var(--radius-m)] border border-warn/30 bg-warn/5 p-3 t-small text-text-2">
          Community storage isn&apos;t connected yet, so posts are kept only temporarily on this server.
        </p>
      )}

      <div className="mt-4 grid gap-3">
        {isEvent && <PlanCard thread={thread} past={mode === "event-past"} onPlan={async (plan) => {
          if (!thread) return;
          const prev = thread;
          const me = thread.me ?? { going: false, interested: false };
          const next = { going: plan === "going", interested: plan === "interested" };
          const s = { ...thread.summary };
          s.going += (next.going ? 1 : 0) - (me.going ? 1 : 0);
          s.interested += (next.interested ? 1 : 0) - (me.interested ? 1 : 0);
          const ok = await act({ action: "plan", plan });
          if (ok) {
            setThread({ ...prev, summary: s, me: { ...me, ...next }, goingPeople: next.going && profile ? [profile.id, ...prev.goingPeople.filter((x) => x !== profile.id)] : prev.goingPeople.filter((x) => x !== profile?.id), profiles: profile ? { ...prev.profiles, [profile.id]: profile } : prev.profiles });
            void load();
          }
        }} />}
        {canRate && <RatingCard thread={thread} title={title} onRate={async (n) => {
          if (await act({ action: "rate", rating: n })) void load();
        }} />}
      </div>

      <Composer mode={mode} profile={profile} onPost={async (body) => {
        const ok = await act({ action: "post", ...body });
        if (ok) {
          setSort("new");
          await load();
        }
        return ok;
      }} />

      {error && <p role="alert" className="t-small text-bad mt-3">{error}</p>}

      {isEvent && mode === "event-upcoming" && (
        <p className="mt-3 flex items-start gap-2 t-micro text-text-3">
          <ShieldAlert size={14} className="shrink-0 mt-px" aria-hidden />
          Never pay strangers for tickets. Buy and resell only through official sellers or the resale platforms listed above.
        </p>
      )}

      <div className="mt-6">
        {thread === null && !error && (
          <div className="grid gap-3" aria-hidden>
            {[0, 1].map((i) => <div key={i} className="skeleton h-20" />)}
          </div>
        )}
        {thread && posts.length === 0 && (
          <div className="rounded-[var(--radius-l)] border border-dashed border-line-strong p-6 text-center">
            <Sparkles size={22} className="mx-auto text-sun" aria-hidden />
            <p className="font-semibold mt-2">Be the first to say something</p>
            <p className="t-small text-text-2 mt-1">{mode === "event-upcoming" ? "Ask a question, share a tip, or find people to go with." : "Your review helps the next person decide."}</p>
          </div>
        )}
        {posts.length > 0 && (
          <>
            <div className="flex items-center gap-1 mb-3" role="tablist" aria-label="Sort posts">
              {(["top", "new"] as Sort[]).map((s) => (
                <button key={s} role="tab" aria-selected={sort === s} onClick={() => setSort(s)} className={`chip ${sort === s ? "!bg-text !text-white !border-text" : ""}`}>
                  {s === "top" ? "Top" : "Newest"}
                </button>
              ))}
            </div>
            <ul className="grid gap-3">
              {posts.map((p) => (
                <PostItem key={p.id} post={p} profiles={thread!.profiles} me={profile} fresh={fresh} act={act} reload={load} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function sortPosts(posts: Post[], sort: Sort): Post[] {
  if (sort === "new") return posts;
  const score = (p: Post) => (p.likes ?? 0) * 3 + (p.replies?.length ?? 0) * 2 + (p.kind === "review" || p.kind === "tip" ? 1 : 0) - (Date.now() - Date.parse(p.createdAt)) / (3 * 86400000);
  return [...posts].sort((a, b) => score(b) - score(a));
}

// ---- Plans ---------------------------------------------------------------------------------

function PlanCard({ thread, past, onPlan }: { thread: Thread | null; past: boolean; onPlan: (plan: "going" | "interested" | "none") => Promise<void> }) {
  const [burst, setBurst] = useState(0);
  const [busy, setBusy] = useState(false);
  const me = thread?.me;
  const s = thread?.summary;
  const people = (thread?.goingPeople ?? []).map((id) => thread!.profiles[id]).filter(Boolean);
  const click = async (plan: "going" | "interested") => {
    setBusy(true);
    const next = (plan === "going" && me?.going) || (plan === "interested" && me?.interested) ? "none" : plan;
    if (next === "going") setBurst((b) => b + 1);
    await onPlan(next);
    setBusy(false);
  };
  return (
    <div className="surface rounded-[var(--radius-l)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <button type="button" disabled={busy || !thread} aria-pressed={!!me?.going} onClick={() => click("going")} className={`btn ${me?.going ? "bg-sun text-text border-sun hover:brightness-105" : "btn-primary"} press`}>
            <span key={me?.going ? "on" : "off"} className={me?.going ? "pop" : ""}>{me?.going ? "✓" : "🎟️"}</span>
            {past ? "I was there" : me?.going ? "You're going" : "I'm going"}
          </button>
          {burst > 0 && <Burst key={burst} />}
        </div>
        {!past && (
          <button type="button" disabled={busy || !thread} aria-pressed={!!me?.interested} onClick={() => click("interested")} className={`btn ${me?.interested ? "bg-cyan/10 text-cyan border-cyan/40" : "btn-secondary"} press`}>
            <Star size={15} fill={me?.interested ? "currentColor" : "none"} aria-hidden />
            Interested
          </button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {people.length > 0 && (
            <span className="avatar-stack flex">
              {people.slice(0, 6).map((p) => <Avatar key={p.id} p={p} size={28} />)}
            </span>
          )}
          <p className="t-small text-text-2 tnum">
            {s ? (
              <>
                <strong className="text-text">{s.going}</strong> {past ? "were there" : "going"}
                {!past && <> · <strong className="text-text">{s.interested}</strong> interested</>}
              </>
            ) : (
              <span className="skeleton inline-block h-4 w-28 align-middle" />
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---- Ratings -------------------------------------------------------------------------------

function RatingCard({ thread, title, onRate }: { thread: Thread | null; title: string; onRate: (n: number) => Promise<void> }) {
  const s = thread?.summary;
  const dist = thread?.ratingDist ?? [0, 0, 0, 0, 0];
  const max = Math.max(1, ...dist);
  const [mine, setMine] = useState(0);
  useEffect(() => setMine(thread?.me?.rating ?? 0), [thread?.me?.rating]);
  return (
    <div className="surface rounded-[var(--radius-l)] p-4 sm:p-5 grid gap-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
      <div className="text-center sm:text-left">
        <p className="text-[44px] font-bold leading-none tracking-tight tnum">{s && s.ratingCount ? s.ratingAvg.toFixed(1) : "–"}</p>
        <Stars value={s?.ratingAvg ?? 0} size={16} className="mt-1.5" />
        <p className="t-micro text-text-3 mt-1 tnum">{s?.ratingCount ? `${s.ratingCount} ${s.ratingCount === 1 ? "rating" : "ratings"}` : "No ratings yet"}</p>
      </div>
      <ul className="grid gap-1" aria-label="Rating breakdown">
        {[5, 4, 3, 2, 1].map((n) => (
          <li key={n} className="flex items-center gap-2 t-micro text-text-3 tnum">
            <span className="w-3 text-right">{n}</span>
            <span className="h-2 flex-1 rounded-full bg-panel-2 overflow-hidden">
              <span className="block h-full rounded-full bg-sun transition-[width] duration-700 ease-out" style={{ width: `${(dist[n - 1] / max) * 100}%` }} />
            </span>
            <span className="w-5">{dist[n - 1]}</span>
          </li>
        ))}
      </ul>
      <div className="sm:border-l sm:border-line sm:pl-5">
        <p className="t-small font-semibold mb-1">{mine ? "Your rating" : `Rate ${title.length > 28 ? "it" : title}`}</p>
        <StarInput value={mine} onChange={(n) => { setMine(n); void onRate(n); }} size={26} />
      </div>
    </div>
  );
}

// ---- Writing -------------------------------------------------------------------------------

function Composer({ mode, profile, onPost, parent, onDone, autoFocus }: { mode: PanelMode; profile: PublicProfile | null; onPost: (b: { kind: PostKind; text: string; rating?: number; parent?: string }) => Promise<boolean>; parent?: string; onDone?: () => void; autoFocus?: boolean }) {
  const kinds = KINDS[mode];
  const [kind, setKind] = useState<PostKind>(parent ? "comment" : kinds[0]);
  const [text, setText] = useState("");
  const [rating, setRating] = useState(0);
  const [busy, setBusy] = useState(false);
  const isReview = kind === "review" && !parent;
  const ready = isReview ? rating > 0 : text.trim().length >= 2;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    const ok = await onPost({ kind, text, rating: isReview ? rating : undefined, parent });
    setBusy(false);
    if (ok) {
      setText("");
      setRating(0);
      onDone?.();
    }
  };

  return (
    <form onSubmit={submit} className={parent ? "mt-2" : "mt-4 surface rounded-[var(--radius-l)] p-3 sm:p-4"}>
      {!parent && (
        <div className="flex flex-wrap gap-1.5 mb-3" role="radiogroup" aria-label="What kind of post">
          {kinds.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`chip press ${kind === k ? "!bg-text !text-white !border-text" : ""}`}>
              <span aria-hidden>{KIND_META[k].emoji}</span> {KIND_META[k].label}
            </button>
          ))}
        </div>
      )}
      {isReview && (
        <div className="mb-2">
          <StarInput value={rating} onChange={setRating} />
        </div>
      )}
      <div className="flex items-start gap-2.5">
        {!parent && <Avatar p={profile} size={36} className="mt-0.5 hidden sm:inline-grid" />}
        <label className="sr-only" htmlFor={`compose-${parent ?? "top"}`}>{parent ? "Write a reply" : KIND_META[kind].label}</label>
        <textarea
          id={`compose-${parent ?? "top"}`}
          className="field flex-1 min-h-[44px] resize-y py-2.5"
          rows={parent ? 1 : 2}
          maxLength={1200}
          autoFocus={autoFocus}
          placeholder={parent ? "Write a reply…" : isReview ? "Add a few words (optional)" : KIND_META[kind].placeholder}
          value={text}
          onFocus={() => !profile && void requireMember(false)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e);
          }}
        />
        <button type="submit" className="btn btn-primary btn-icon h-11 w-11 shrink-0" disabled={!ready || busy} aria-label={parent ? "Send reply" : "Post"}>
          <Send size={17} aria-hidden />
        </button>
      </div>
      {!parent && text.length > 900 && <p className="t-micro text-text-3 mt-1 text-right tnum">{1200 - text.length} left</p>}
    </form>
  );
}

// ---- Reading -------------------------------------------------------------------------------

type Act = (body: Record<string, unknown>) => Promise<boolean>;

function PostItem({ post, profiles, me, fresh, act, reload, isReply }: { post: Post; profiles: Record<string, PublicProfile>; me: PublicProfile | null; fresh: Set<string>; act: Act; reload: () => Promise<void>; isReply?: boolean }) {
  const author = profiles[post.author];
  const [liked, setLiked] = useState(!!post.liked);
  const [likes, setLikes] = useState(post.likes ?? 0);
  const [replying, setReplying] = useState(false);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.text);
  const [reported, setReported] = useState(false);
  useEffect(() => {
    setLiked(!!post.liked);
    setLikes(post.likes ?? 0);
  }, [post.liked, post.likes]);
  const mine = me?.id === post.author;

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
    <li className={`${isReply ? "" : "surface rounded-[var(--radius-l)] p-4"} ${fresh.has(post.id) ? "flash-new" : ""} ${isReply ? "rounded-[var(--radius-m)] p-2 -mx-2" : ""}`}>
      <div className="flex gap-3">
        <Avatar p={author} size={isReply ? 28 : 36} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 t-small">
            <MemberName p={author} />
            {!isReply && post.kind !== "comment" && (
              <span className="rounded-full bg-panel-2 px-2 py-px text-[11px] font-semibold text-text-2">
                {KIND_META[post.kind].emoji} {KIND_META[post.kind].label}
              </span>
            )}
            {post.rating && <Stars value={post.rating} size={13} />}
            <span className="text-text-3 t-micro">{ago(post.createdAt)}{post.editedAt ? " · edited" : ""}</span>
            {!post.deleted && (
              <div className="relative ml-auto">
                <button type="button" className="btn btn-ghost btn-icon h-7 w-7" aria-label="More actions" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                  <MoreHorizontal size={16} aria-hidden />
                </button>
                {menu && (
                  <div className="absolute right-0 z-20 mt-1 w-40 surface-float rounded-[var(--radius-m)] p-1 panel-in" onMouseLeave={() => setMenu(false)}>
                    {mine ? (
                      <>
                        <button type="button" className="w-full text-left rounded px-2.5 py-1.5 t-small hover:bg-panel-2" onClick={() => { setEditing(true); setMenu(false); }}>Edit</button>
                        <button type="button" className="w-full text-left rounded px-2.5 py-1.5 t-small text-bad hover:bg-bad/5" onClick={async () => { setMenu(false); if (confirm("Delete this post?") && (await act({ action: "delete", post: post.id }))) void reload(); }}>Delete</button>
                      </>
                    ) : (
                      <button type="button" disabled={reported} className="w-full text-left rounded px-2.5 py-1.5 t-small hover:bg-panel-2" onClick={async () => { setMenu(false); if (await act({ action: "report", post: post.id })) setReported(true); }}>
                        {reported ? "Reported, thanks" : "Report"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {post.deleted ? (
            <p className="t-small text-text-3 italic mt-1">This post was deleted.</p>
          ) : editing ? (
            <form className="mt-1.5 grid gap-2" onSubmit={async (e) => { e.preventDefault(); if (await act({ action: "edit", post: post.id, text: draft })) { setEditing(false); void reload(); } }}>
              <textarea className="field min-h-[60px] py-2" value={draft} maxLength={1200} onChange={(e) => setDraft(e.target.value)} />
              <div className="flex gap-2 justify-end">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setDraft(post.text); }}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm">Save</button>
              </div>
            </form>
          ) : (
            post.text && <p className={`mt-1 whitespace-pre-line break-words ${isReply ? "t-small" : "t-body"}`}>{post.text}</p>
          )}
          {!post.deleted && (
            <div className="mt-2 flex items-center gap-1">
              <button type="button" onClick={like} aria-pressed={liked} aria-label={liked ? "Unlike" : "Like"} className={`btn btn-ghost btn-sm h-8 px-2 ${liked ? "text-coral" : "text-text-3"}`}>
                <Heart key={String(liked)} size={15} fill={liked ? "currentColor" : "none"} className={liked ? "pop" : ""} aria-hidden />
                <span className="tnum">{likes || ""}</span>
              </button>
              {!isReply && (
                <button type="button" onClick={async () => { if (await requireMember(!!me)) setReplying((r) => !r); }} className="btn btn-ghost btn-sm h-8 px-2 text-text-3">
                  <MessageCircle size={15} aria-hidden /> Reply
                </button>
              )}
            </div>
          )}
          {!isReply && (post.replies?.length ?? 0) > 0 && (
            <ul className="mt-2 grid gap-1 border-l-2 border-line pl-3">
              {post.replies!.map((r) => <PostItem key={r.id} post={r} profiles={profiles} me={me} fresh={fresh} act={act} reload={reload} isReply />)}
            </ul>
          )}
          {replying && (
            <Composer mode="city" profile={me} parent={post.id} autoFocus onDone={() => setReplying(false)} onPost={async (b) => {
              const ok = await act({ action: "post", ...b });
              if (ok) await reload();
              return ok;
            }} />
          )}
        </div>
      </div>
    </li>
  );
}
