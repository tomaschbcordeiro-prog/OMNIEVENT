"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import type { Notices } from "@/lib/community/types";
import { ago, communityGet, communityPost, refreshMe, setUnread, useMe } from "@/lib/community/client";
import { Avatar } from "./bits";

/** Replies and likes on the member's posts; checks for new ones every minute. */
export function NotificationBell({ className = "" }: { className?: string }) {
  const { profile, unread } = useMe();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Notices | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profile) return;
    const id = setInterval(() => document.visibilityState === "visible" && void refreshMe(), 60000);
    return () => clearInterval(id);
  }, [profile]);

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

  if (!profile) return null;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    try {
      setData(await communityGet<Notices>("view=notifications"));
      if (unread) {
        setUnread(0);
        void communityPost({ action: "seen" });
      }
    } catch {
      setData({ items: [], unread: 0, profiles: {} });
    }
  };

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={toggle} aria-expanded={open} aria-label={unread ? `Notifications, ${unread} new` : "Notifications"} className={`btn btn-ghost btn-icon relative ${className}`}>
        <Bell size={19} aria-hidden className={unread ? "pop" : ""} key={unread} />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-coral px-1 text-[10.5px] font-bold text-white tnum ring-2 ring-panel">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-24px))] surface-float rounded-[var(--radius-l)] p-2 panel-in">
          <p className="px-2 pt-1 pb-2 t-small font-semibold">Your activity</p>
          {!data && <div className="skeleton h-16 m-2" aria-hidden />}
          {data && data.items.length === 0 && <p className="px-2 pb-3 t-small text-text-2">Nothing yet. When someone replies to you, likes your post or follows you, it shows up here.</p>}
          <ul className="max-h-[60vh] overflow-auto scroll-thin grid gap-0.5">
            {data?.items.map((n, i) => {
              const by = data.profiles[n.by];
              return (
                <li key={`${n.post}-${n.at}-${i}`}>
                  <Link href={n.type === "follow" ? `/community/u/${by?.username ?? n.by}` : n.meta ? `${n.meta.href}#community` : "/community"} onClick={() => setOpen(false)} className={`flex gap-2.5 rounded-[var(--radius-m)] p-2 hover:bg-panel-2 ${i < (data.unread || 0) ? "bg-cyan/5" : ""}`}>
                    <Avatar p={by} size={32} />
                    <span className="min-w-0 t-small">
                      <span className="block">
                        <strong>{by?.name ?? "Someone"}</strong> {n.type === "reply" ? "replied" : n.type === "follow" ? "started following you" : "liked your post"}
                        {n.meta && <> on <strong>{n.meta.title}</strong></>}
                      </span>
                      {n.text && <span className="block text-text-2 truncate">“{n.text}”</span>}
                      <span className="block t-micro text-text-3">{n.type === "like" ? "❤️ " : n.type === "follow" ? "👋 " : "💬 "}{ago(n.at)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
