import type { Metadata } from "next";
import Link from "next/link";
import { ensureFresh, groupCounts } from "@/lib/store";
import { GROUPS, childrenOf } from "@/lib/categories";
import { CategoryIcon } from "@/components/ui";
import { Footer } from "@/components/footer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Categories",
  description: "Browse music, sport, theatre, comedy, festivals, cinema, conferences, exhibitions, attractions, food, nightlife, family and outdoor events.",
  alternates: { canonical: "/categories" },
};

export default async function CategoriesPage() {
  await ensureFresh();
  const counts = groupCounts();
  const groups = GROUPS.filter((g) => g.active && g.slug !== "other").sort((a, b) => a.order - b.order);
  const [lead, ...rest] = [groups.slice(0, 3), groups.slice(3)];

  return (
    <>
      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-8">
        <h1 className="t-h1">What are you into?</h1>
        <p className="t-body text-text-2 mt-1 measure">Pick a category to see what&apos;s on, where, and how much it costs. Counts show listed upcoming events from connected sources.</p>

        {/* The three largest worlds get room; everything else is a scannable index. */}
        <div className="mt-8 grid gap-3 md:grid-cols-3">
          {lead.map((g) => (
            <Link key={g.slug} href={`/categories/${g.slug}`} className="group relative overflow-hidden rounded-[var(--radius-l)] border border-line bg-panel p-5 hover:border-line-strong">
              <CategoryIcon slug={g.slug} size={28} />
              <h2 className="t-h2 mt-4 group-hover:text-cyan">{g.name}</h2>
              <p className="t-small text-text-2 mt-1">{g.description}</p>
              <p className="t-small text-text-3 mt-3 tnum">{(counts[g.slug] ?? 0).toLocaleString()} upcoming</p>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {childrenOf(g.slug).slice(0, 8).map((c) => (
                  <li key={c.slug} className="t-micro text-text-2 rounded-full border border-line px-2 py-0.5">{c.name}</li>
                ))}
              </ul>
            </Link>
          ))}
        </div>

        <ul className="mt-6 grid gap-x-8 md:grid-cols-2 divide-y divide-line md:divide-y-0">
          {rest.flat().map((g) => (
            <li key={g.slug} className="md:border-b md:border-line">
              <Link href={`/categories/${g.slug}`} className="group flex items-start gap-4 py-4">
                <CategoryIcon slug={g.slug} size={22} className="mt-0.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="t-h3 group-hover:text-cyan">{g.name}</span>
                    <span className="t-small text-text-3 tnum shrink-0">{(counts[g.slug] ?? 0).toLocaleString()}</span>
                  </span>
                  <span className="block t-small text-text-2 mt-0.5">{g.description}</span>
                  {childrenOf(g.slug).length > 0 && (
                    <span className="block t-micro text-text-3 mt-1.5">{childrenOf(g.slug).map((c) => c.name).join(", ")}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <Footer />
    </>
  );
}
