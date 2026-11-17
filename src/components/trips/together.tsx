"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, CloudOff, Copy, Crown, Eye, Globe2, Link2, Loader2, LogOut, Pencil, RefreshCw, Share2, ShieldCheck, Users, X } from "lucide-react";
import type { GroupLink, Trip } from "@/lib/user/store";
import { inviteLink, manageTrip, prettyPin, rememberName, rememberedName, startSharing, stopSharing, useSyncState } from "@/lib/group-sync";
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
export function TogetherBar({ trip, onOpen }: { trip: Trip; onOpen: () => void }) {
  const g = trip.group;
  const state = useSyncState(trip.id);
  if (!g) return null;
  const others = g.members.filter((m) => m.id !== g.me);
  return (
    <button type="button" className="together-bar press" onClick={onOpen} aria-label={`Planned together with ${others.map((m) => m.name).join(", ") || "nobody yet"}. ${state === "saved" ? "All changes saved" : state === "saving" ? "Saving" : state === "offline" ? "Offline: changes will be sent later" : "Couldn't save: will try again"}. Open people and invites`}>
      <span className="together-faces" aria-hidden>
        {g.members.slice(0, 4).map((m) => (
          <PersonDot key={m.id} id={m.id} name={m.name} size={24} ring />
        ))}
        {g.members.length > 4 && <span className="together-more">+{g.members.length - 4}</span>}
      </span>
      <span className="together-state" data-state={state}>
        {state === "saving" ? <Loader2 size={12} className="animate-spin" aria-hidden /> : state === "offline" ? <CloudOff size={12} aria-hidden /> : state === "error" ? <RefreshCw size={12} aria-hidden /> : <Check size={12} aria-hidden />}
        {state === "saved" ? (others.length ? `With ${others.length === 1 ? others[0].name : `${others.length} people`}` : "Invite people") : state === "saving" ? "Saving…" : state === "offline" ? "Offline" : "Retrying"}
      </span>
      {g.role === "viewer" && (
        <span className="together-role">
          <Eye size={12} aria-hidden /> View only
        </span>
      )}
    </button>
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
                  {m.seen && m.id !== g.me ? ` · active ${ago(m.seen)}` : ""}
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
