"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleUserRound, Globe2, LogOut, Pencil, Settings, UserRound } from "lucide-react";
import { signOut, useMe } from "@/lib/community/client";
import { Avatar, openAccount } from "./bits";
import { toast } from "../toast";

/** Header account control: sign in / create account, or the member's avatar with a menu. */
export function AccountMenu({ floating = false }: { floating?: boolean }) {
  const { profile, loaded } = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pill = floating ? "rounded-full bg-panel/90 backdrop-blur-md shadow-[0_8px_24px_-12px_rgb(10_50_120_/_0.45)]" : "";

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!loaded) return <span className={`btn btn-ghost btn-icon ${pill}`} aria-hidden><CircleUserRound size={19} /></span>;

  if (!profile?.username)
    return (
      <div className={`flex items-center gap-1 ${floating ? "rounded-full bg-panel/90 backdrop-blur-md shadow-[0_8px_24px_-12px_rgb(10_50_120_/_0.45)] p-1" : ""}`}>
        <button type="button" className="btn btn-ghost btn-sm hidden sm:inline-flex rounded-full" onClick={() => void openAccount("signin")}>
          Sign in
        </button>
        <button type="button" className="btn btn-primary btn-sm rounded-full press" onClick={() => void openAccount(profile ? "complete" : "signup")}>
          {profile ? "Finish account" : "Join"}
        </button>
      </div>
    );

  const item = "flex items-center gap-2.5 rounded-[var(--radius-s)] px-3 py-2 text-sm hover:bg-text/[0.05] w-full text-left";
  return (
    <div ref={ref} className="relative">
      <button type="button" className={`press rounded-full p-0.5 ${floating ? "bg-panel/90 shadow-[0_8px_24px_-12px_rgb(10_50_120_/_0.45)]" : ""}`} aria-haspopup="menu" aria-expanded={open} aria-label={`Account: ${profile.name}`} onClick={() => setOpen((o) => !o)}>
        <Avatar p={profile} size={34} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 rounded-[var(--radius-m)] border border-line bg-panel p-1.5 shadow-xl panel-in">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Avatar p={profile} size={40} />
            <div className="min-w-0">
              <p className="font-semibold truncate">{profile.name}</p>
              <p className="t-small text-text-2 truncate">@{profile.username} · {profile.karma} pts</p>
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link role="menuitem" href={`/community/u/${profile.username}`} className={item} onClick={() => setOpen(false)}>
            <UserRound size={16} aria-hidden /> Your profile
          </Link>
          <button role="menuitem" type="button" className={item} onClick={() => { setOpen(false); void openAccount("edit"); }}>
            <Pencil size={16} aria-hidden /> Edit profile
          </button>
          <Link role="menuitem" href="/my-world" className={item} onClick={() => setOpen(false)}>
            <Globe2 size={16} aria-hidden /> My World
          </Link>
          <Link role="menuitem" href="/my-world?tab=account" className={item} onClick={() => setOpen(false)}>
            <Settings size={16} aria-hidden /> Preferences
          </Link>
          <div className="my-1 h-px bg-line" />
          <button
            role="menuitem"
            type="button"
            className={`${item} text-bad`}
            onClick={async () => {
              setOpen(false);
              await signOut();
              toast({ title: "Signed out", emoji: "👋" });
            }}
          >
            <LogOut size={16} aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
