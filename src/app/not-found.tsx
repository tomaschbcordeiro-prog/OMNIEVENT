import type { Metadata } from "next";
import Link from "next/link";
import { SearchBox } from "@/components/search-box";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 pt-24 pb-24">
      <p className="t-small font-semibold text-text-3">Error 404</p>
      <h1 className="t-h1 mt-1">We couldn&apos;t find that page</h1>
      <p className="t-lede text-text-2 mt-3">It may have moved, or the link has a typo. If it was an event, its source may have taken it down. Search for it, or start from the globe.</p>
      <SearchBox className="mt-6" placeholder="Search events, artists, places" />
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/" className="btn btn-primary">Explore the globe</Link>
        <Link href="/events" className="btn btn-secondary">Browse all events</Link>
      </div>
    </main>
  );
}
