import type { Metadata } from "next";
import Link from "next/link";
import { ensureFresh, cityStats } from "@/lib/store";
import { CONTINENTS, CITIES } from "@/lib/destinations";
import { ClusterMap } from "@/components/cluster-map";
import { Footer } from "@/components/footer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Destinations",
  description: "Explore events by continent, country and city, and plan a trip around the experiences you want.",
  alternates: { canonical: "/destinations" },
};

export default async function DestinationsPage() {
  await ensureFresh();
  const stats = cityStats();
  return (
    <>
      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr] items-end">
          <div>
            <h1 className="t-display">Go where it&apos;s happening</h1>
            <p className="t-body text-text-2 mt-2 measure">
              Pick a city to see everything on during your dates, from matches and concerts to museums and family days out. Then build a trip from several events across cities.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/my-world?tab=trips" className="btn btn-primary">Plan a trip</Link>
              <Link href="/?view=globe" className="btn btn-secondary">Explore on the globe</Link>
            </div>
          </div>
          <ClusterMap params="" initial={{ lat: 25, lng: 10, alt: 2.6 }} className="h-72" />
        </div>

        <div className="mt-14 grid gap-10">
          {CONTINENTS.map((ct) => {
            const cities = CITIES.filter((c) => c.continent === ct.id).sort((a, b) => (stats[b.id]?.total ?? 0) - (stats[a.id]?.total ?? 0));
            const total = cities.reduce((s, c) => s + (stats[c.id]?.total ?? 0), 0);
            return (
              <section key={ct.id} aria-labelledby={`ct-${ct.id}`} className="grid gap-4 md:grid-cols-[220px_1fr] border-t border-line pt-6">
                <div>
                  <h2 id={`ct-${ct.id}`} className="t-h2">
                    <Link href={`/destinations/${ct.slug}`} className="hover:text-cyan">{ct.name}</Link>
                  </h2>
                  <p className="t-small text-text-3 tnum mt-1">{total.toLocaleString()} upcoming in {cities.length} cities</p>
                </div>
                <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2">
                  {cities.map((c) => (
                    <li key={c.id}>
                      <Link href={`/destinations/${c.slug}`} className="group flex items-baseline justify-between gap-2 py-1 border-b border-transparent hover:border-line">
                        <span className="truncate group-hover:text-cyan">{c.name}<span className="text-text-3 t-small">, {c.country}</span></span>
                        <span className="t-small text-text-3 tnum shrink-0">{stats[c.id]?.total ?? 0}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </main>
      <Footer />
    </>
  );
}
