"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 pt-24 pb-24">
      <h1 className="t-h1">This page didn&apos;t load</h1>
      <p className="t-body text-text-2 mt-3">Something failed on our side while loading events. Your saved items are safe.</p>
      <button className="btn btn-primary mt-6" onClick={reset}>Try again</button>
    </main>
  );
}
