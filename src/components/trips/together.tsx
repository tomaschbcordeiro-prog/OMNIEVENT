"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, CloudOff, Copy, Crown, Eye, Globe2, Link2, Loader2, LogOut, MessageCircle, Pencil, RefreshCw, SendHorizontal, Share2, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import type { GroupLink, Trip } from "@/lib/user/store";
import { inviteLink, manageTrip, markSeen, prettyPin, rememberName, rememberedName, sendMessage, startSharing, stopSharing, usePresence, useSyncState } from "@/lib/group-sync";
import { toast } from "../toast";

/** A person's colour, the same on every device. */
export function personHue(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]?.toUpperCase() ?? "")
    .join("");

export function PersonDot({ id, name, size = 28, ring }: { id: string; name: string; size?: number; ring?: boolean }) {
  return (
    <span className="person-dot" data-ring={ring ? "" : undefined} style={{ "--h": personHue(id), width: size, height: size, fontSize: Math.round(size * 0.4) } as React.CSSProperties} aria-hidden>
      {initials(name) || "?"}
    </span>
  );
}

const ago = (iso?: string) => {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/** Who's in a shared trip, as overlapping faces, and whether this device's changes are in. */
export function TogetherBar({ trip, onOpen, onChat, since: sinceAt }: { trip: Trip; onOpen: () => void; onChat: () => void; /** When this device last had the trip open (changes after it are news). */ since?: string }) {
  const g = trip.group;
  const state = useSyncState(trip.id);
  const here = usePresence(trip.id);
  if (!g) return null;
  const others = g.members.filter((m) => m.id !== g.me);
  const hereNow = others.filter((m) => here.includes(m.id));
  const unread = (trip.messages ?? []).filter((m) => m.by !== g.me && (!g.lastRead || m.at > g.lastRead)).length;
  const myName = g.members.find((m) => m.id === g.me)?.name;
  // What others did since this device last opened the trip.
  const since = sinceAt ? g.log.filter((l) => l.at > sinceAt && l.by !== myName) : [];
  const status = state === "saved" ? "All changes saved" : state === "saving" ? "Saving" : state === "offline" ? "Offline: changes will be sent later" : "Couldn't save: will try again";
  return (
    <div className="together-row">
      <button type="button" className="together-bar press" onClick={onOpen} aria-label={`Planned together with ${others.map((m) => m.name).join(", ") || "nobody yet"}${hereNow.length ? `; ${hereNow.map((m) => m.name).join(", ")} here now` : ""}. ${status}. Open people and invites`}>
        <span className="together-faces" aria-hidden>
          {g.members.slice(0, 4).map((m) => (
            <span key={m.id} className="together-face" data-here={m.id !== g.me && here.includes(m.id) ? "" : undefined}>
              <PersonDot id={m.id} name={m.name} size={24} ring />
            </span>
          ))}
          {g.members.length > 4 && <span className="together-more">+{g.members.length - 4}</span>}
        </span>
        <span className="together-state" data-state={state}>
          {state === "saving" ? <Loader2 size={12} className="animate-spin" aria-hidden /> : state === "offline" ? <CloudOff size={12} aria-hidden /> : state === "error" ? <RefreshCw size={12} aria-hidden /> : hereNow.length ? <span className="here-dot" aria-hidden /> : <Check size={12} aria-hidden />}
          {state !== "saved" ? (state === "saving" ? "Saving…" : state === "offline" ? "Offline" : "Retrying") : hereNow.length ? `${hereNow.length === 1 ? hereNow[0].name : `${hereNow.length} people`} here now` : others.length ? `With ${others.length === 1 ? others[0].name : `${others.length} people`}` : "Invite people"}
        </span>
        {g.role === "viewer" && (
          <span className="together-role">
            <Eye size={12} aria-hidden /> View only
          </span>
        )}
      </button>
      {others.length > 0 && (
        <button type="button" className="together-chat press" onClick={onChat} aria-label={unread ? `Chat: ${unread} new ${unread === 1 ? "message" : "messages"}` : "Chat with the people on this trip"}>
          <MessageCircle size={16} aria-hidden />
          {unread > 0 && <span className="together-unread tnum" aria-hidden>{unread > 9 ? "9+" : unread}</span>}
        </button>
      )}
      {since.length > 0 && (
        <button type="button" className="together-since press" onClick={onOpen}>
          <Sparkles size={12} aria-hidden className="shrink-0" />
          <span className="min-w-0">
            {since.length} {since.length === 1 ? "change" : "changes"} since you were here: <b>{since[since.length - 1].by}</b> {since[since.length - 1].text}
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * The trip's chat: a few words between the people planning it ("I booked the hotel!", "Who
 * brings the adapter?"), right next to the trip. The newest at the bottom, like any chat.
 */
export function TripChat({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [text, setText] = useState("");
  const g = trip.group;
  const messages = trip.messages ?? [];
  useEffect(() => {
    ref.current?.showModal();
    markSeen(trip.id, "chat");
  }, [trip.id]);
  // New messages: scroll to them, and they count as read while the chat is open.
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: "end" });
    if (messages.length) markSeen(trip.id, "chat");
  }, [messages.length, trip.id]);
  if (!g) return null;
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    sendMessage(trip.id, text);
    setText("");
  };
  return (
    <dialog
      ref={ref}
      aria-labelledby="chat-h"
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClick={(e) => e.target === ref.current && onClose()}
      className="dialog-backdrop chat-dialog m-auto w-[min(480px,calc(100vw-16px))] h-[min(640px,calc(100dvh-16px))] rounded-[var(--radius-l)] bg-panel p-0 text-text shadow-2xl backdrop:bg-[rgb(13_27_51_/_0.45)] backdrop:backdrop-blur-sm"
    >
      <div className="chat-wrap panel-in">
        <header className="chat-head">
          <span className="together-faces" aria-hidden>
            {g.members.slice(0, 4).map((m) => <PersonDot key={m.id} id={m.id} name={m.name} size={26} ring />)}
          </span>
          <span className="min-w-0 flex-1">
            <h2 id="chat-h" className="font-semibold truncate">{trip.name}</h2>
            <span className="block t-micro text-text-2 truncate">{g.members.map((m) => (m.id === g.me ? "you" : m.name)).join(", ")}</span>
          </span>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Close the chat" onClick={onClose}><X size={18} aria-hidden /></button>
        </header>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <MessageCircle size={28} aria-hidden className="text-text-3" />
            <p className="t-small text-text-2">Say hello, ask who books what, share a find. Only the people on this trip see it.</p>
            <div className="flex flex-wrap justify-center gap-1.5 mt-2">
              {["I booked the hotel!", "Who's bringing the adapter?", "Shall we add a day in the mountains?"].map((x) => (
                <button key={x} type="button" className="chip chip-idea press" onClick={() => setText(x)}>{x}</button>
              ))}
            </div>
          </div>
        ) : (
          <ol ref={list} className="chat-list" aria-live="polite" aria-label="Messages">
            {messages.map((m, i) => {
              const mine = m.by === g.me;
              const prev = messages[i - 1];
              const newDay = !prev || day(prev.at) !== day(m.at);
              const sameAuthor = prev && prev.by === m.by && !newDay;
              return (
                <li key={m.id} className="chat-item" data-mine={mine ? "" : undefined}>
                  {newDay && <p className="chat-day">{day(m.at)}</p>}
                  <div className="chat-line">
                    {!mine && <span className="chat-avatar" aria-hidden>{!sameAuthor && <PersonDot id={m.by} name={m.name} size={26} />}</span>}
                    <div className="chat-bubble">
                      {!mine && !sameAuthor && <span className="chat-name" style={{ "--h": personHue(m.by) } as React.CSSProperties}>{m.name}</span>}
                      <span className="chat-text">{m.text}</span>
                      <span className="chat-time tnum">{time(m.at)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <form className="chat-compose" onSubmit={send}>
          <label htmlFor="chat-new" className="sr-only">Message</label>
          <textarea
            id="chat-new"
            className="field chat-input"
            rows={1}
            value={text}
            maxLength={1000}
            placeholder="Message the group…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(e);
              }
            }}
          />
          <button type="submit" className="btn btn-primary btn-icon press" aria-label="Send" disabled={!text.trim()}><SendHorizontal size={17} aria-hidden /></button>
        </form>
      </div>
    </dialog>
  );
}

/**
 * Planning a trip together: invite with a link or a PIN, see who's in, who does what, and
 * what changed. Before it's shared: what sharing means, and one button. Publishing a copy for
 * inspiration (the public kind of sharing) is offered too, as the other choice.
 */
export function TogetherDialog({ trip, onClose, onPublish }: { trip: Trip; onClose: () => void; onPublish: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const g = trip.group;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "pin" | null>(null);
  useEffect(() => {
    ref.current?.showModal();
    setName(rememberedName());
  }, []);
  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const copy = (what: "link" | "pin", text: string) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => (setCopied(what), window.setTimeout(() => setCopied(null), 1800)))
      .catch(() => {});

  return (
    <dialog
      ref={ref}
      aria-labelledby="together-h"
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClick={(e) => e.target === ref.current && onClose()}
      className="dialog-backdrop together-dialog m-auto w-[min(540px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-[var(--radius-l)] bg-panel p-0 text-text shadow-2xl backdrop:bg-[rgb(13_27_51_/_0.45)] backdrop:backdrop-blur-sm"
    >
      <div className="panel-in p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="together-h" className="t-h2">{g ? "Planning together" : "Plan this trip together"}</h2>
            <p className="t-small text-text-2 mt-1">
              {g ? "Everyone here sees and changes the same trip: route, bookings, costs and lists." : "Invite the people you're travelling with. Everyone sees and changes the same trip, live."}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon -mr-2 -mt-1" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </div>

        {!g ? (
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              rememberName(name);
              void run("start", async () => {
                await startSharing(trip.id, name.trim());
                toast({ title: "Ready to invite", body: "Send the link or the PIN to the people coming with you.", emoji: "🤝" });
              });
            }}
          >
            <ul className="together-points">
              <li><Users size={16} aria-hidden /> Everyone edits the same trip: the route, flights, stays, events, costs and lists.</li>
              <li><ShieldCheck size={16} aria-hidden /> Private: only people you invite can open it. You can take anyone out.</li>
              <li><Share2 size={16} aria-hidden /> Costs are split between you, with who owes whom.</li>
            </ul>
            <label className="block mt-4">
              <span className="label">Your name, as the others will see it</span>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required placeholder="e.g. Tomás" autoComplete="given-name" />
            </label>
            {error && <p className="mt-3 t-small text-bad" role="alert">{error}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="submit" className="btn btn-primary press" disabled={!!busy || !name.trim()}>
                {busy === "start" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Users size={16} aria-hidden />} Start sharing
              </button>
              <button type="button" className="btn btn-ghost press" onClick={onClose}>Not now</button>
            </div>
          </form>
        ) : (
          <SharedBody trip={trip} g={g} busy={busy} copied={copied} copy={copy} run={run} onClose={onClose} />
        )}
        {error && g && <p className="mt-3 t-small text-bad" role="alert">{error}</p>}

        <div className="together-public mt-5">
          <Globe2 size={16} aria-hidden className="shrink-0 text-text-3" />
          <p className="t-small text-text-2 flex-1">
            Something else: <b className="text-text">publish a copy for inspiration</b>. Everyone can see the route and plan their own; your dates, bookings and costs stay private.
          </p>
          <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={onPublish}>{trip.sharedId ? "Published" : "Publish"}</button>
        </div>
      </div>
    </dialog>
  );
}

function SharedBody({ trip, g, busy, copied, copy, run, onClose }: { trip: Trip; g: GroupLink; busy: string | null; copied: "link" | "pin" | null; copy: (w: "link" | "pin", t: string) => void; run: (what: string, fn: () => Promise<unknown>) => Promise<void>; onClose: () => void }) {
  const owner = g.role === "owner";
  const canInvite = g.role !== "viewer";
  const here = usePresence(trip.id);
  const link = g.invite ? inviteLink(g.invite) : "";
  const shareNative = () =>
    void navigator
      .share?.({ title: trip.name, text: `Join our trip “${trip.name}” on Mundivi${g.code ? ` (PIN ${prettyPin(g.code)})` : ""}`, url: link })
      .catch(() => {});
  return (
    <>
      {g.testMode && <p className="mt-3 rounded-[var(--radius-m)] border border-warn/30 bg-warn/5 p-2.5 t-micro text-text-2">Shared trips are in test mode for now: they may be cleared. Each of you keeps a copy on your device.</p>}
      {canInvite && g.code && (
        <section className="mt-4" aria-labelledby="invite-h">
          <h3 id="invite-h" className="t-small font-semibold">Invite</h3>
          {!g.open && <p className="t-micro text-warn mt-1">Joining is closed: the link and PIN don&apos;t work until it&apos;s opened again.</p>}
          <div className="invite-grid mt-2">
            <div className="invite-box">
              <span className="t-micro text-text-2 flex items-center gap-1"><Link2 size={12} aria-hidden /> Link</span>
              <span className="invite-link truncate">{link.replace(/^https?:\/\//, "")}</span>
              <div className="flex gap-1.5 mt-2">
                <button type="button" className="btn btn-primary btn-sm press" onClick={() => copy("link", link)}>
                  {copied === "link" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied === "link" ? "Copied" : "Copy link"}
                </button>
                {typeof navigator !== "undefined" && "share" in navigator && (
                  <button type="button" className="btn btn-secondary btn-sm press" onClick={shareNative}>
                    <Share2 size={14} aria-hidden /> Send
                  </button>
                )}
              </div>
            </div>
            <div className="invite-box">
              <span className="t-micro text-text-2">Or the PIN, typed in Trips → Join with a PIN</span>
              <span className="invite-pin tnum" aria-label={`PIN ${g.code.split("").join(" ")}`}>{prettyPin(g.code)}</span>
              <button type="button" className="btn btn-secondary btn-sm press mt-2 self-start" onClick={() => copy("pin", prettyPin(g.code!))}>
                {copied === "pin" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied === "pin" ? "Copied" : "Copy PIN"}
              </button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 t-micro">
            <button type="button" className="text-text-2 hover:text-text underline underline-offset-2" disabled={!!busy} onClick={() => void run("pin", () => manageTrip(trip.id, { do: "new-pin" }))}>
              {busy === "pin" ? "Making new ones…" : "New link and PIN (the old ones stop working)"}
            </button>
            {owner && (
              <button type="button" className="text-text-2 hover:text-text underline underline-offset-2" disabled={!!busy} onClick={() => void run("open", () => manageTrip(trip.id, { do: "open", open: !g.open }))}>
                {g.open ? "Close joining" : "Open joining again"}
              </button>
            )}
          </div>
        </section>
      )}

      <section className="mt-5" aria-labelledby="people-h">
        <h3 id="people-h" className="t-small font-semibold">{g.members.length} {g.members.length === 1 ? "person" : "people"}</h3>
        <ul className="mt-2 grid gap-1">
          {g.members.map((m) => (
            <li key={m.id} className="person-row">
              <PersonDot id={m.id} name={m.name} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold truncate">
                  {m.name} {m.id === g.me && <span className="t-micro font-normal text-text-3">(you)</span>}
                </span>
                <span className="block t-micro text-text-2">
                  {m.role === "owner" ? "Owner" : m.role === "editor" ? "Can edit" : "Can view"}
                  {m.id !== g.me && here.includes(m.id) ? " · here now" : m.seen && m.id !== g.me ? ` · active ${ago(m.seen)}` : ""}
                </span>
              </span>
              {owner && m.id !== g.me ? (
                <>
                  <label className="sr-only" htmlFor={`role-${m.id}`}>What {m.name} can do</label>
                  <select id={`role-${m.id}`} className="field !h-9 !w-auto touch:!text-base text-sm" value={m.role} disabled={!!busy} onChange={(e) => {
                    const role = e.target.value;
                    if (role === "owner" && !window.confirm(`Make ${m.name} the owner? You'll stay in the trip as an editor.`)) return;
                    void run(`role-${m.id}`, () => manageTrip(trip.id, { do: "role", member: m.id, role }));
                  }}>
                    <option value="editor">Can edit</option>
                    <option value="viewer">Can view</option>
                    <option value="owner">Make owner</option>
                  </select>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Take ${m.name} out of the trip`} disabled={!!busy} onClick={() => window.confirm(`Take ${m.name} out of the trip? They'll keep their own copy, unshared.`) && void run(`rm-${m.id}`, () => manageTrip(trip.id, { do: "remove", member: m.id }))}>
                    <X size={15} aria-hidden />
                  </button>
                </>
              ) : m.role === "owner" ? (
                <Crown size={15} className="text-amber shrink-0" aria-label="Owner" />
              ) : m.id === g.me ? (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Change your name" onClick={() => {
                  const n = window.prompt("Your name in this trip", m.name)?.trim();
                  if (n) void run("rename", () => manageTrip(trip.id, { do: "rename", name: n }));
                }}>
                  <Pencil size={14} aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {g.log.length > 0 && (
        <section className="mt-5" aria-labelledby="history-h">
          <h3 id="history-h" className="t-small font-semibold">What changed</h3>
          <ol className="together-log mt-2">
            {[...g.log].reverse().slice(0, 12).map((l, i) => (
              <li key={`${l.at}-${i}`}>
                <b>{l.by}</b> {l.text} <span className="text-text-3">· {ago(l.at)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-secondary press" onClick={onClose}>Done</button>
        <span className="flex-1" />
        {owner ? (
          <button type="button" className="btn btn-ghost btn-sm text-bad press" disabled={!!busy} onClick={() => window.confirm("Stop sharing this trip? Everyone keeps their own copy, but changes won't be shared any more.") && void run("stop", async () => (await stopSharing(trip.id), onClose()))}>
            Stop sharing
          </button>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm text-bad press" disabled={!!busy} onClick={() => window.confirm("Leave this trip? You'll keep a copy on this device.") && void run("leave", async () => (await manageTrip(trip.id, { do: "leave" }), onClose()))}>
            <LogOut size={14} aria-hidden /> Leave
          </button>
        )}
      </div>
      <p className="t-micro text-text-3 mt-3">
        Joining needs no account: the link or PIN is enough, so send them only to people you trust. <Link href="/help" className="underline underline-offset-2">Help</Link>
      </p>
    </>
  );
}
