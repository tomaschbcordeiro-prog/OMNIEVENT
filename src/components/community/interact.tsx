"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, SmilePlus } from "lucide-react";
import { REACTIONS, type Post, type PublicProfile, type ThreadHead } from "@/lib/community/types";
import { communityGet, communityPost, CommunityRequestError } from "@/lib/community/client";
import { Avatar, requireMember } from "./bits";
import { toast } from "../toast";

/**
 * Interactive pieces shared by conversations and the community feed: text with @mentions and
 * links, emoji reactions, "I'm in" on meet-ups, live "new posts" checks and @name suggestions.
 */

// ---- Text ------------------------------------------------------------------------------------

const TOKEN_RE = /(^|[^\w@.])(@[a-z0-9][a-z0-9._]{1,18}[a-z0-9])(?![\w.])|(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)])/gi;

/** Post text: @names link to profiles, web addresses open in a new tab (marked as user content). */
export function RichText({ text, className = "" }: { text: string; className?: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index! + (m[1]?.length ?? 0);
    if (start > last) out.push(text.slice(last, start));
    if (m[2]) {
      const u = m[2].slice(1).toLowerCase();
      out.push(<Link key={start} href={`/community/u/${u}`} className="font-semibold text-cyan hover:underline">{m[2]}</Link>);
      last = start + m[2].length;
    } else if (m[3]) {
      let host = m[3];
      try {
        host = new URL(m[3]).host.replace(/^www\./, "");
      } catch {
        // keep the raw text
      }
      out.push(
        <a key={start} href={m[3]} target="_blank" rel="nofollow ugc noopener noreferrer" className="inline-flex items-center gap-0.5 text-cyan underline underline-offset-2 break-all">
          {host}
          <ExternalLink size={12} aria-hidden />
        </a>,
      );
      last = start + m[3].length;
    }
  }
  if (last < text.length) out.push(text.slice(last));
  return <p className={`whitespace-pre-line break-words ${className}`}>{out.map((x, i) => <Fragment key={i}>{x}</Fragment>)}</p>;
}

// ---- Reactions -------------------------------------------------------------------------------

const REACTION_NAMES: Record<string, string> = { "❤️": "Love", "🔥": "Fire", "😂": "Funny", "🙌": "Yes!", "😮": "Wow" };

/**
 * One reaction per member and post. Existing reactions show as pills (tap yours to take it
 * back, tap another to switch); the smiley opens the full set.
 */
export function Reactions({ post, me, size = "md" }: { post: Post; me: PublicProfile | null; size?: "sm" | "md" }) {
  const [counts, setCounts] = useState<Record<string, number>>(post.reactions ?? (post.likes ? { "❤️": post.likes } : {}));
  const [mine, setMine] = useState<string | undefined>(post.myReaction ?? (post.liked ? "❤️" : undefined));
  const [open, setOpen] = useState(false);
  const [popped, setPopped] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setCounts(post.reactions ?? (post.likes ? { "❤️": post.likes } : {}));
    setMine(post.myReaction ?? (post.liked ? "❤️" : undefined));
  }, [post.reactions, post.myReaction, post.likes, post.liked]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const pick = async (emoji: string) => {
    setOpen(false);
    if (!(await requireMember(!!me))) return;
    const next = mine === emoji ? undefined : emoji;
    const before = { counts, mine };
    // Answer at once; the server's numbers follow.
    const c = { ...counts };
    if (mine) c[mine] = Math.max(0, (c[mine] ?? 1) - 1);
    if (next) c[next] = (c[next] ?? 0) + 1;
    setCounts(c);
    setMine(next);
    if (next) setPopped(next);
    try {
      const r = await communityPost<{ reactions: Record<string, number>; mine?: string }>({ action: "react", post: post.id, emoji: next ?? null });
      setCounts(r.reactions);
      setMine(r.mine);
    } catch (err) {
      setCounts(before.counts);
      setMine(before.mine);
      toast({ title: err instanceof CommunityRequestError ? err.message : "Couldn't react right now", emoji: "⚠️" });
    }
  };

  const shown = REACTIONS.filter((e) => (counts[e] ?? 0) > 0);
  const h = size === "sm" ? "h-7" : "h-8";
  return (
    <div ref={box} className="relative flex flex-wrap items-center gap-1">
      {shown.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => void pick(e)}
          aria-pressed={mine === e}
          aria-label={`${REACTION_NAMES[e]}: ${counts[e]}${mine === e ? ", yours. Tap to remove" : ""}`}
          className={`press inline-flex items-center gap-1 ${h} rounded-full border px-2 text-[13px] tnum transition-colors ${mine === e ? "border-cyan/50 bg-cyan/10 text-cyan font-semibold" : "border-line bg-panel hover:border-line-strong text-text-2"}`}
        >
          <span key={popped === e ? `p-${counts[e]}` : e} className={popped === e ? "pop" : ""} aria-hidden>{e}</span>
          {counts[e]}
        </button>
      ))}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Add a reaction" className={`press inline-grid place-items-center ${h} w-8 rounded-full text-text-3 hover:text-text hover:bg-panel-2`}>
        <SmilePlus size={16} aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="Reactions" className="absolute left-0 bottom-full mb-1.5 z-30 flex gap-0.5 rounded-full surface-float px-1.5 py-1 panel-in">
          {REACTIONS.map((e) => (
            <button key={e} role="menuitemradio" aria-checked={mine === e} type="button" onClick={() => void pick(e)} aria-label={REACTION_NAMES[e]} title={REACTION_NAMES[e]} className={`reaction-pick grid h-10 w-10 place-items-center rounded-full text-[22px] ${mine === e ? "bg-cyan/10" : "hover:bg-panel-2"}`}>
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Meet-ups --------------------------------------------------------------------------------

/** "I'm in" on a meet-up: who's joining, and a reminder to meet somewhere public. */
export function MeetupJoin({ post, profiles, me }: { post: Post; profiles: Record<string, PublicProfile>; me: PublicProfile | null }) {
  const [joined, setJoined] = useState(!!post.joined);
  const [joins, setJoins] = useState(post.joins ?? 0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setJoined(!!post.joined);
    setJoins(post.joins ?? 0);
  }, [post.joined, post.joins]);
  const mine = me?.id === post.author;
  const people = (post.joiners ?? []).map((id) => profiles[id]).filter(Boolean);
  const toggle = async () => {
    if (!(await requireMember(!!me))) return;
    setBusy(true);
    setJoined(!joined);
    setJoins((n) => n + (joined ? -1 : 1));
    try {
      const r = await communityPost<{ joined: boolean; joins: number }>({ action: "join", post: post.id });
      setJoined(r.joined);
      setJoins(r.joins);
      if (r.joined) toast({ title: "You're in!", emoji: "👋", body: "Reply to agree on the details. Meet somewhere busy and public." });
    } catch (err) {
      setJoined(joined);
      setJoins(post.joins ?? 0);
      toast({ title: err instanceof CommunityRequestError ? err.message : "Couldn't join right now", emoji: "⚠️" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-m)] bg-sun/10 border border-sun/40 px-3 py-2">
      {!mine && (
        <button type="button" disabled={busy} onClick={() => void toggle()} aria-pressed={joined} className={`btn btn-sm press ${joined ? "bg-text text-white" : "bg-sun text-text hover:brightness-105"}`}>
          {joined ? "✓ You're in" : "👋 I'm in"}
        </button>
      )}
      {people.length > 0 && (
        <span className="avatar-stack flex" aria-hidden>
          {people.slice(0, 5).map((p) => <Avatar key={p.id} p={p} size={24} />)}
        </span>
      )}
      <span className="t-small text-text-2 tnum">
        {joins ? `${joins} ${joins === 1 ? "person is" : "people are"} in` : mine ? "Nobody has joined yet" : "Be the first to join"}
      </span>
    </div>
  );
}

// ---- Live updates ----------------------------------------------------------------------------

/**
 * Checks every half minute (only while the tab is visible) whether anything new was posted.
 * The check is tiny and shared through the CDN; the full conversation loads only when asked.
 */
export function useNewPosts(query: string, latestShown: string | null | undefined) {
  const [fresh, setFresh] = useState(0);
  const base = useRef<ThreadHead | null>(null);
  useEffect(() => {
    base.current = null;
    setFresh(0);
  }, [query, latestShown]);
  useEffect(() => {
    if (latestShown === undefined) return;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const h = await communityGet<ThreadHead>(query);
        if (!base.current) base.current = { posts: h.posts, latest: latestShown };
        if (h.latest && h.latest !== base.current.latest) setFresh(Math.max(1, h.posts - base.current.posts));
      } catch {
        // try again next time
      }
    };
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [query, latestShown]);
  return fresh;
}

/** The "new posts" pill that loads them on request (content doesn't jump while you read). */
export function NewPostsPill({ count, onShow }: { count: number; onShow: () => void }) {
  if (!count) return null;
  return (
    <div className="sticky top-[calc(var(--header-h)+0.75rem)] z-20 flex justify-center pointer-events-none">
      <button type="button" onClick={onShow} className="pointer-events-auto press panel-in btn btn-primary rounded-full shadow-lg" aria-live="polite">
        <span className="live-dot live-dot--on" aria-hidden /> {count === 1 ? "1 new post" : `${count} new posts`}, show
      </button>
    </div>
  );
}

// ---- @mentions -------------------------------------------------------------------------------

/** The "@word" being typed just before the caret, if any. */
function mentionAt(value: string, caret: number): { start: number; q: string } | null {
  const m = value.slice(0, caret).match(/(?:^|[^\w@.])@([a-z0-9._]{0,20})$/i);
  return m ? { start: caret - m[1].length - 1, q: m[1].toLowerCase() } : null;
}

/**
 * Suggestions while typing @name: people in this conversation first. Returns the handlers for
 * the textarea and the list to render under it.
 */
export function useMentions(value: string, setValue: (v: string) => void, people: PublicProfile[]) {
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const at = mentionAt(value, caret);
  const options = at && !dismissed ? people.filter((p) => p.username && (p.username.startsWith(at.q) || p.name.toLowerCase().includes(at.q))).slice(0, 5) : [];
  const insert = (p: PublicProfile, el: HTMLTextAreaElement | null) => {
    if (!at || !p.username) return;
    const next = `${value.slice(0, at.start)}@${p.username} ${value.slice(caret)}`;
    setValue(next);
    const pos = at.start + p.username.length + 2;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };
  const track = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCaret(e.currentTarget.selectionStart ?? 0);
    setDismissed(false);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!options.length) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insert(options[Math.min(active, options.length - 1)], e.currentTarget);
      return true;
    }
    if (e.key === "Escape") {
      setDismissed(true);
      return true;
    }
    return false;
  };
  const list = (el: HTMLTextAreaElement | null) =>
    options.length > 0 ? (
      <ul role="listbox" aria-label="Mention someone" className="absolute left-0 right-0 top-full mt-1 z-30 surface-float rounded-[var(--radius-m)] p-1 panel-in">
        {options.map((p, i) => (
          <li key={p.id} role="option" aria-selected={i === active}>
            <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p, el)} className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left t-small ${i === active ? "bg-cyan/10" : "hover:bg-panel-2"}`}>
              <Avatar p={p} size={24} />
              <span className="font-semibold">{p.name}</span>
              <span className="text-text-3">@{p.username}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : null;
  return { track, onKeyDown, list };
}
