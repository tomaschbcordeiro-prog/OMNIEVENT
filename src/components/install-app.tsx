"use client";

import { useEffect, useState } from "react";
import { Download, Share } from "lucide-react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/**
 * "Install the app": Chrome, Edge and Android offer to install the site (it's a web app with a
 * manifest), and this button asks them to. On an iPhone or iPad, where Safari has no such
 * prompt, it says how to add it from the Share menu. Nothing shows once it's installed.
 */
export function InstallApp({ className = "" }: { className?: string }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;
    const ua = navigator.userAgent;
    // Safari on iPhone/iPad (other iOS browsers can't add to the home screen the same way).
    if ((/iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)) setIos(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => {
      setDone(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (done) return <p className={`t-small text-text-2 ${className}`}>Installed. OMNIEVENT is on your home screen.</p>;
  if (prompt)
    return (
      <button
        type="button"
        className={`install-app ${className}`}
        onClick={async () => {
          await prompt.prompt();
          const { outcome } = await prompt.userChoice.catch(() => ({ outcome: "dismissed" as const }));
          if (outcome === "accepted") setDone(true);
          setPrompt(null);
        }}
      >
        <Download size={15} aria-hidden /> Install the app
      </button>
    );
  if (ios)
    return (
      <p className={`t-small text-text-2 inline-flex items-center gap-1.5 flex-wrap ${className}`}>
        Get the app: tap <Share size={14} aria-label="Share" className="text-text" /> then <span className="text-text font-medium">Add to Home Screen</span>.
      </p>
    );
  return null;
}
