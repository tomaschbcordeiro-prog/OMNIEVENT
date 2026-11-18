"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { OpeningMode } from "./opening-stage";

/*
 * The first time someone opens Mundivi, an opening scene (opening-stage.tsx): a planet at
 * night that lights up from their side of the world and turns under their finger, then dives
 * into the real globe. Shown once in a browser; an installed app gets a short version of the
 * ignition at each launch. The head's script (lib/theme-boot.ts) decides before the first paint
 * and the page draws the first frame itself, so the scene's own code is only fetched by those
 * who will see it.
 */

export const INTRO_SEEN = "mundivi:intro";
export const SPLASH_SEEN = "mundivi:splash";

const OpeningStage = dynamic(() => import("./opening-stage"), { ssr: false });

export function OpeningScene() {
  const [mode, setMode] = useState<OpeningMode | null>(null);
  useEffect(() => {
    const flag = document.documentElement.getAttribute("data-intro");
    if (flag === "full" || flag === "splash") setMode(flag);
  }, []);
  const done = useCallback(() => {
    try {
      if (mode === "full") localStorage.setItem(INTRO_SEEN, String(Date.now()));
      sessionStorage.setItem(SPLASH_SEEN, "1");
    } catch {
      // Private mode: it shows again next time, nothing worse.
    }
    document.documentElement.removeAttribute("data-intro");
    window.dispatchEvent(new Event("omni:intro-done"));
    setMode(null);
  }, [mode]);
  if (!mode) return null;
  return <OpeningStage mode={mode} onDone={done} />;
}
