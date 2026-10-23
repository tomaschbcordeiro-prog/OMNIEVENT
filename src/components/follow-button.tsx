"use client";

import { Check, Plus } from "lucide-react";
import { userActions, useUser, type FollowKind } from "@/lib/user/store";

export function FollowButton({ kind, id, name }: { kind: FollowKind; id: string; name: string }) {
  const user = useUser();
  const on = user.follows.some((f) => f.kind === kind && f.id === id);
  return (
    <button type="button" aria-pressed={on} onClick={() => userActions.toggleFollow(kind, id, name)} className={`btn btn-sm ${on ? "btn-secondary text-cyan" : "btn-secondary"}`}>
      {on ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
      {on ? "Following" : "Follow"}
    </button>
  );
}
