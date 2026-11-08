"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Shown on a page rendered by a server that had only just started: it says the rest of the
 * catalogue is on its way and reloads the page's data, in place, once it's there.
 */
export function StillLoading({ partial, count }: { partial: boolean; count: number }) {
  const router = useRouter();
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!partial) return;
    let stop = false;
    let tries = 0;
    const check = async () => {
      if (stop) return;
      const r = await fetch("/api/ready", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      if (stop) return;
      // Ready, or a minute gone by: the page's data is fetched again (in place) and the note goes.
      if (r?.ready || ++tries >= 24) {
        setGone(true);
        router.refresh();
      } else setTimeout(check, 2500);
    };
    const t = setTimeout(check, 2000);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [partial, router]);
  if (!partial || gone) return null;
  return (
    <div className="still-loading panel-in" role="status">
      <Loader2 size={15} className="animate-spin shrink-0" aria-hidden />
      <span>
        Loading events from around the world… <span className="tnum">{count.toLocaleString("en-GB")}</span> so far. This page updates by itself.
      </span>
    </div>
  );
}
