import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 pt-24 pb-24">
      <h1 className="t-h1">We couldn&apos;t find that page</h1>
      <p className="t-body text-text-2 mt-3">The event may have been removed by its source, or demo data may have been regenerated. Try searching instead.</p>
      <div className="mt-6 flex gap-2">
        <Link href="/" className="btn btn-primary">Explore the globe</Link>
        <Link href="/events" className="btn btn-secondary">Browse all events</Link>
      </div>
    </main>
  );
}
