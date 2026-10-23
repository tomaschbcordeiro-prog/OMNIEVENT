"use client";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <main className="mx-auto max-w-xl px-4 pt-24 pb-24">
      <h1 className="t-h1">This page hit a problem</h1>
      <p className="t-body text-text-2 mt-3">Something went wrong while showing this page. Your saved events are safe. Try again, or open the list of all events.</p>
      <div className="mt-6 flex gap-2">
        <button className="btn btn-primary" onClick={reset}>Try again</button>
        {/* Full reload on purpose: recovers from a broken client state. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="btn btn-secondary" href="/events">All events</a>
      </div>
      <p className="t-micro text-text-3 mt-8">Technical details: {error.message || "unknown error"}{error.digest ? ` (${error.digest})` : ""}</p>
    </main>
  );
}
