"use client";
import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/** Tries again by itself this many times: the usual cause is a new server still loading events. */
const AUTO_RETRIES = 2;
const RETRY_SECONDS = 6;

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [left, setLeft] = useState<number | null>(null);

  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });

  useEffect(() => {
    console.error(error);
    // Counted per page for this tab, so a page that keeps failing stops retrying.
    const key = `omnievent:retry:${location.pathname}${location.search}`;
    let tries = 0;
    try {
      tries = Number(sessionStorage.getItem(key) ?? 0);
      sessionStorage.setItem(key, String(tries + 1));
    } catch {
      // storage unavailable: one automatic retry at most
      tries = AUTO_RETRIES - 1;
    }
    if (tries >= AUTO_RETRIES) return;
    setLeft(RETRY_SECONDS);
    const tick = window.setInterval(() => setLeft((s) => (s == null ? s : Math.max(0, s - 1))), 1000);
    const go = window.setTimeout(retry, RETRY_SECONDS * 1000);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(go);
    };
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="mx-auto max-w-xl px-4 pt-24 pb-24">
      {left != null ? (
        <>
          <h1 className="t-h1">Almost there</h1>
          <p className="t-body text-text-2 mt-3">This server has just woken up and is still loading events from around the world. We&apos;ll try again in a moment.</p>
          <p className="t-small text-text-3 mt-4 flex items-center gap-2" role="status">
            <Loader2 size={15} className="animate-spin" aria-hidden /> Trying again in {left} s
          </p>
        </>
      ) : (
        <>
          <h1 className="t-h1">This page hit a problem</h1>
          <p className="t-body text-text-2 mt-3">Something went wrong while showing this page. Your saved events are safe. Try again, or open the list of all events.</p>
        </>
      )}
      <div className="mt-6 flex gap-2">
        <button className="btn btn-primary" onClick={retry}>Try again now</button>
        {/* Full reload on purpose: recovers from a broken client state. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="btn btn-secondary" href="/events">All events</a>
      </div>
      <p className="t-micro text-text-3 mt-8">Technical details: {error.message || "unknown error"}{error.digest ? ` (${error.digest})` : ""}</p>
    </main>
  );
}
