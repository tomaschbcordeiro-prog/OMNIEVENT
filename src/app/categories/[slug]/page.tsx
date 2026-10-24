import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureFresh, searchEvents, sportsMeta } from "@/lib/store";
import { getCategory, childrenOf, GLOBE_MODES, GROUPS } from "@/lib/categories";
import { getDestination } from "@/lib/destinations";
import { parseFilterParams, filtersToParams } from "@/lib/search/params";
import { formatEventTime, formatShortDate } from "@/lib/format";
import { EventsBrowser } from "@/components/events-browser";
import { ClusterMap } from "@/components/cluster-map";
import { Suspense } from "react";
import { ContinueSearch } from "@/components/continue-search";
import { CategoryIcon, DemoBadge, Price, StatusBadge } from "@/components/ui";
import { Footer } from "@/components/footer";
import type { EventCard } from "@/lib/types";

export const dynamic = "force-dynamic";
type P = Promise<{ slug: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const { slug } = await params;
  const c = getCategory(slug);
  if (!c) return { title: "Category not found" };
  return { title: `${c.name} events`, description: c.description, alternates: { canonical: `/categories/${slug}` } };
}

function Fixtures({ items }: { items: EventCard[] }) {
  if (!items.length) return <p className="t-small text-text-2">No fixtures match. Try another sport or competition.</p>;
  return (
    <div className="overflow-x-auto rounded-[var(--radius-l)] border border-line">
      <table className="w-full text-sm">
        <caption className="sr-only">Upcoming fixtures</caption>
        <thead className="bg-panel-2 text-left text-text-2">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Date</th>
            <th scope="col" className="px-3 py-2 font-medium">Match</th>
            <th scope="col" className="px-3 py-2 font-medium hidden md:table-cell">Competition</th>
            <th scope="col" className="px-3 py-2 font-medium hidden lg:table-cell">Venue</th>
            <th scope="col" className="px-3 py-2 font-medium text-right">From</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((c) => {
            const d = formatShortDate(c.start, c.timeZone);
            const teams = c.people.filter((p) => p.role.startsWith("team") || p.role === "competitor");
            return (
              <tr key={c.id} className="hover:bg-white/[0.02]">
                <td className="px-3 py-2.5 tnum whitespace-nowrap align-top">
                  <span className="block font-medium">{d.weekday} {d.day} {d.month}</span>
                  <span className="t-micro text-text-3">{formatEventTime(c.start, c.timeZone)} local</span>
                </td>
                <td className="px-3 py-2.5 align-top">
                  <Link href={`/events/${c.slug}`} className="font-medium hover:text-cyan">
                    {teams.length === 2 ? <>{teams[0].name} <span className="text-text-3 font-normal">vs</span> {teams[1].name}</> : c.title}
                  </Link>
                  <span className="flex items-center gap-1.5 mt-1">
                    {c.isDemo && <DemoBadge />}
                    {c.status !== "on_sale" && <StatusBadge status={c.status} />}
                    <span className="t-micro text-text-3 md:hidden">{c.sports?.competition}</span>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-text-2 hidden md:table-cell align-top">
                  {c.sports?.competition}
                  {c.sports?.stage && <span className="block t-micro text-text-3">{c.sports.stage}</span>}
                </td>
                <td className="px-3 py-2.5 text-text-2 hidden lg:table-cell align-top">
                  {c.venueName}
                  <span className="block t-micro text-text-3">{c.city}, {c.country}</span>
                </td>
                <td className="px-3 py-2.5 text-right align-top whitespace-nowrap">
                  <Price amount={c.fromPrice?.amount} currency={c.fromPrice?.currency} feesIncluded={c.fromPrice?.feesIncluded} isFree={c.isFree} from={false} className="t-small" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function CategoryPage({ params, searchParams }: { params: P; searchParams: SP }) {
  const { slug } = await params;
  const cat = getCategory(slug);
  if (!cat || cat.parent) {
    // Subcategory URLs resolve to their group page with the subcategory selected.
    if (cat?.parent) {
      const { redirect } = await import("next/navigation");
      redirect(`/categories/${cat.parent}?cat=${cat.slug}`);
    }
    notFound();
  }
  const sp = await searchParams;
  const raw = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") raw.set(k, v);
  if (raw.get("sub") && !raw.get("cat")) raw.set("cat", raw.get("sub")!);
  raw.delete("sub");
  await ensureFresh();
  const parsed = parseFilterParams(raw);
  const filters = parsed.ok ? parsed.filters : {};
  if (!filters.categories?.length) filters.categories = [slug];
  const selectedSub = filters.categories.find((c) => c !== slug);
  const result = searchEvents(filters);
  const subs = childrenOf(slug);
  const related = GROUPS.filter((g) => g.slug !== slug && GLOBE_MODES.some((m) => m.groups.includes(slug) && m.groups.includes(g.slug)));
  const topCities = Object.entries(result.facets.cities).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const isSports = slug === "sports";
  const sm = isSports ? sportsMeta() : null;
  const fixtures = isSports ? searchEvents({ ...filters, categories: filters.categories, sort: "date", page: 1, pageSize: 12, status: undefined }).items : [];
  const mapParams = filtersToParams({ categories: filters.categories, from: filters.from, to: filters.to }).toString();

  return (
    <>
      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-8">
        <nav aria-label="Breadcrumb" className="t-small text-text-3 mb-4">
          <Link href="/categories" className="hover:text-text">Categories</Link> <span aria-hidden>/</span> {cat.name}
        </nav>
        <div className="grid gap-8 lg:grid-cols-[1fr_440px] items-start">
          <div>
            <CategoryIcon slug={slug} size={34} />
            <h1 className="t-display mt-3">{cat.name}</h1>
            <p className="t-body text-text-2 mt-2 measure">{cat.description}</p>
            <p className="t-small text-text-3 mt-2 tnum">{result.total.toLocaleString()} upcoming events listed{selectedSub ? ` in ${getCategory(selectedSub)?.name}` : ""}</p>
            {subs.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-1.5" role="group" aria-label="Subcategories">
                <Link href={`/categories/${slug}`} className="chip" data-active={!selectedSub}>All {cat.name.split(" &")[0].toLowerCase()}</Link>
                {subs.map((s) => (
                  <Link key={s.slug} href={`/categories/${slug}?cat=${s.slug}`} className="chip" data-active={selectedSub === s.slug} aria-current={selectedSub === s.slug ? "page" : undefined}>
                    {s.name}
                  </Link>
                ))}
              </div>
            )}
            {topCities.length > 0 && (
              <div className="mt-6">
                <h2 className="t-h3">Where it&apos;s happening</h2>
                <p className="t-micro text-text-3">Cities with the most listed events in this category.</p>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 t-small">
                  {topCities.map(([id, n]) => (
                    <li key={id}>
                      <Link href={`/destinations/${id}?cat=${filters.categories!.join(",")}`} className="hover:text-cyan">{getDestination(id)?.name ?? id}</Link>
                      <span className="text-text-3 tnum"> {n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <ClusterMap params={mapParams} initial={{ lat: 25, lng: 10, zoom: 0.4 }} className="h-72 lg:h-80" />
        </div>

        {isSports && sm && (
          <section className="mt-12" aria-labelledby="fixtures">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
              <div>
                <h2 id="fixtures" className="t-h2">Fixtures</h2>
                <p className="t-small text-text-2">Only fixtures our sources list. We never infer matches or teams.</p>
              </div>
              <form className="flex flex-wrap gap-2" action={`/categories/${slug}`}>
                {selectedSub && <input type="hidden" name="cat" value={selectedSub} />}
                <label className="sr-only" htmlFor="sport">Sport</label>
                <select id="sport" name="sport" defaultValue={filters.sport ?? ""} className="field !h-8 !w-auto !text-[13px]">
                  <option value="">All sports</option>
                  {sm.sports.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <label className="sr-only" htmlFor="competition">Competition</label>
                <select id="competition" name="competition" defaultValue={filters.competition ?? ""} className="field !h-8 !w-auto !text-[13px]">
                  <option value="">All competitions</option>
                  {sm.competitions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button className="btn btn-secondary btn-sm">Apply</button>
              </form>
            </div>
            <Fixtures items={fixtures} />
          </section>
        )}

        <section className="mt-12" aria-labelledby="all">
          <Suspense fallback={null}>
            <ContinueSearch keep={["categories"]} />
          </Suspense>
          <h2 id="all" className="t-h2 mb-4">{isSports ? "All sports events" : `All ${cat.name.toLowerCase()}`}</h2>
          <EventsBrowser result={result} filters={filters} hideCategoryStrip basePath={`/categories/${slug}`} />
        </section>

        {related.length > 0 && (
          <section className="mt-12" aria-labelledby="related">
            <h2 id="related" className="t-h3">Related categories</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link href={`/categories/${r.slug}`} className="chip">
                    <CategoryIcon slug={r.slug} size={14} /> {r.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}
