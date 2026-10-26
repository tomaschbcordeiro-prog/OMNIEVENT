"use client";

import Link from "next/link";
import { BADGES } from "@/lib/community/types";
import { useMe } from "@/lib/community/client";
import { Avatar, openAccount, requireMember } from "./bits";

/** My World: the member's community profile at a glance. */
export function MyCommunity() {
  const { profile, loaded } = useMe();
  if (!loaded) return <div className="skeleton h-40" aria-hidden />;
  if (!profile?.username)
    return (
      <div className="surface rounded-[var(--radius-l)] p-6">
        <h2 className="t-h2">{profile ? "Finish your account" : "Join the community"}</h2>
        <p className="t-body text-text-2 mt-1 measure">Rate venues and shows, ask questions before you go, share tips and see who else is going. Create an account with your name, a username and your email, and use it on any device.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary press" onClick={() => void requireMember(false)}>{profile ? "Finish my account" : "Create an account"}</button>
          <button type="button" className="btn btn-secondary" onClick={() => void openAccount("signin")}>Sign in</button>
        </div>
      </div>
    );
  return (
    <div className="grid gap-4">
      <div className="surface rounded-[var(--radius-l)] p-5 flex flex-wrap items-center gap-4">
        <Avatar p={profile} size={64} />
        <div className="min-w-0 flex-1">
          <h2 className="t-h2">{profile.name}</h2>
          <p className="t-small text-text-2">@{profile.username}</p>
          <p className="t-small text-text-2 tnum">{profile.karma} {profile.karma === 1 ? "point" : "points"} · {profile.counts.posts} posts · {profile.counts.reviews} ratings · {profile.counts.going} plans</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {profile.badges.map((b) => <span key={b} className="rounded-full bg-sun/15 px-2 py-0.5 t-micro font-semibold">{BADGES[b]?.emoji} {BADGES[b]?.label}</span>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void requireMember(true, true)}>Edit profile</button>
          <Link href={`/community/u/${profile.username}`} className="btn btn-secondary btn-sm">Public profile</Link>
          <Link href="/community" className="btn btn-primary btn-sm">Open the community</Link>
        </div>
      </div>
    </div>
  );
}
