"use client";

import { useEffect, useState } from "react";
import { MessageCircle, Star, Ticket } from "lucide-react";
import type { Summary } from "@/lib/community/types";
import { communityGet } from "@/lib/community/client";

/** One line of community activity that jumps to the conversation. */
export function CommunityPulse({ target }: { target: string }) {
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    communityGet<Record<string, Summary>>(`view=summaries&targets=${encodeURIComponent(target)}`).then((r) => setS(r[target] ?? null), () => {});
  }, [target]);
  const any = s && (s.going || s.interested || s.posts || s.ratingCount);
  return (
    <a href="#community" className="press flex items-center gap-3 rounded-[var(--radius-m)] border border-line bg-panel-2/60 px-3 py-2.5 t-small hover:border-cyan/40 hover:bg-cyan/5">
      {any ? (
        <>
          <span className="flex items-center gap-1 font-semibold"><Ticket size={14} className="text-sun" aria-hidden />{s.going} going</span>
          {s.ratingCount > 0 && <span className="flex items-center gap-1"><Star size={14} className="text-sun" fill="currentColor" strokeWidth={0} aria-hidden />{s.ratingAvg.toFixed(1)}</span>}
          <span className="flex items-center gap-1 text-text-2"><MessageCircle size={14} aria-hidden />{s.posts}</span>
          <span className="ml-auto text-cyan font-medium">Join in</span>
        </>
      ) : (
        <>
          <span aria-hidden>👋</span>
          <span className="text-text-2">Going? Tell the community and find people to go with.</span>
        </>
      )}
    </a>
  );
}
