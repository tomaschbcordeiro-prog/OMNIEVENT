"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Ban, LogOut, MonitorSmartphone, ShieldCheck, UserCog } from "lucide-react";
import type { PublicProfile } from "@/lib/community/types";
import { communityGet, communityPost, signOut, useMe } from "@/lib/community/client";
import { Avatar, openAccount, requireMember } from "./bits";
import { toast } from "../toast";

/**
 * The account in My World: who you're signed in as, profile settings, signing out here or on
 * every device, and the members you've blocked (with unblock).
 */
export function AccountPanel() {
  const { profile, account, loaded } = useMe();
  const [blocked, setBlocked] = useState<PublicProfile[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile?.username) return setBlocked(null);
    communityGet<{ members: PublicProfile[] }>("view=blocked").then((r) => setBlocked(r.members), () => setBlocked([]));
  }, [profile?.username]);

  if (!loaded) return <div className="skeleton h-32 rounded-[var(--radius-l)]" aria-hidden />;

  if (!profile?.username)
    return (
      <div className="rounded-[var(--radius-l)] border border-line p-5">
        <p className="font-semibold">{profile ? "Finish your account" : "You're not signed in"}</p>
        <p className="t-small text-text-2 mt-1 measure">
          Saved events, trips and preferences stay in this browser. An account lets you join the community: post, rate, react and plan with others, on any device.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => void requireMember(false)}>{profile ? "Finish my account" : "Create an account"}</button>
          {!profile && <button type="button" className="btn btn-secondary" onClick={() => void openAccount("signin")}>Sign in</button>}
        </div>
      </div>
    );

  const everywhere = async () => {
    if (!confirm("Sign out on every device, this one included? You'll need your password to sign in again.")) return;
    setBusy(true);
    try {
      const r = await communityPost<{ ended: number }>({ action: "signout-all" });
      await signOut();
      toast({ title: "Signed out everywhere", emoji: "🔒", body: r.ended > 1 ? `${r.ended} devices were signed out.` : undefined });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Something went wrong", emoji: "⚠️" });
    } finally {
      setBusy(false);
    }
  };

  const unblock = async (p: PublicProfile) => {
    try {
      await communityPost({ action: "block", member: p.id });
      setBlocked((list) => (list ?? []).filter((x) => x.id !== p.id));
      toast({ title: `${p.firstName ?? p.name} is unblocked`, emoji: "👌" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Something went wrong", emoji: "⚠️" });
    }
  };

  return (
    <div className="grid gap-4">
      <div className="rounded-[var(--radius-l)] border border-line p-5 flex flex-wrap items-center gap-4">
        <Avatar p={profile} size={56} />
        <div className="min-w-0 flex-1">
          <p className="t-h3 truncate">{profile.name}</p>
          <p className="t-small text-text-2 truncate">@{profile.username}{account?.email ? ` · ${account.email}` : ""}</p>
          <Link href={`/community/u/${profile.username}`} className="t-small text-cyan hover:underline">Your public profile</Link>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void requireMember(true, true)}>
          <UserCog size={16} aria-hidden /> Profile and password
        </button>
      </div>

      <div className="rounded-[var(--radius-l)] border border-line p-5">
        <p className="font-semibold flex items-center gap-2"><ShieldCheck size={17} className="text-ok" aria-hidden /> Security</p>
        <p className="t-small text-text-2 mt-1 measure">
          Changing your password signs you out on every other device. If you think someone else is using your account, sign out everywhere and choose a new password.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => void signOut().then(() => toast({ title: "Signed out", emoji: "👋" }))}>
            <LogOut size={16} aria-hidden /> Sign out here
          </button>
          <button type="button" className="btn btn-secondary text-bad" disabled={busy} onClick={() => void everywhere()}>
            <MonitorSmartphone size={16} aria-hidden /> Sign out on all devices
          </button>
        </div>
      </div>

      <div className="rounded-[var(--radius-l)] border border-line p-5">
        <p className="font-semibold flex items-center gap-2"><Ban size={17} className="text-text-3" aria-hidden /> Blocked members</p>
        <p className="t-small text-text-2 mt-1 measure">They don&apos;t know you blocked them. You don&apos;t see their posts; they can&apos;t reply to you, mention you, follow you or join your meet-ups.</p>
        {blocked === null ? (
          <div className="skeleton h-10 mt-3" aria-hidden />
        ) : blocked.length === 0 ? (
          <p className="t-small text-text-3 mt-3">Nobody. Block someone from the ⋯ menu on their post or from their profile.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {blocked.map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                <Avatar p={p} size={32} />
                <span className="min-w-0 flex-1 t-small"><strong>{p.name}</strong> <span className="text-text-3">@{p.username}</span></span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void unblock(p)}>Unblock</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
