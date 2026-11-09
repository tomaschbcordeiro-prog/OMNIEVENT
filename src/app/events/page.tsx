import type { Metadata } from "next";
import Link from "next/link";
import { catalogueComplete, dataSummary, ensureFresh, searchEvents } from "@/lib/store";
import { StillLoading } from "@/components/still-loading";
import { parseFilterParams } from "@/lib/search/params";
import { parseQuery } from "@/lib/search/parse";
import { EventsBrowser } from "@/components/events-browser";
import { didYouMean } from "@/lib/search/did-you-mean";
import { Footer } from "@/components/footer";
import { Notice } from "@/components/ui";
import { getDestination } from "@/lib/destinations";
import { Suspense } from "react";
import { ContinueSearch } from "@/components/continue-search";
import { summarizeSearch } from "@/lib/search/summary";
import { getHere } from "@/lib/here";
import { HerePill } from "@/components/here-pill";
import type { SearchFilters } from "@/lib/types";

/** Whether a search already says where (then the visitor's city isn't added). */
const saysWhere = (f: SearchFilters) => !!(f.city || f.country || f.continent || f.near || f.places?.length || f.group || f.venue);

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

function toParams(sp: Record<string, string | string[] | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") p.set(k, v);
  return p;
}

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const p = toParams(await searchParams);
  const city = p.get("city") ? getDestination(p.get("city")!)?.name : undefined;
  return {
    title: city ? `Events in ${city}` : "All events",
    description: "Search concerts, sport, theatre, festivals, conferences, exhibitions and attractions worldwide, with dates, prices and official ticket links.",
    alternates: { canonical: "/events" },
  };
}

const NOTICES: Record<string, string> = {
  "offer-expired": "That ticket offer is no longer listed. Prices and availability change often; here are current events.",
  "offer-unavailable": "That seller didn't provide a valid purchase link for this offer.",
};

export default async function EventsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const params = toParams(sp);
  const asked = params.get("asked");
  const notice = params.get("notice");
  const anywhere = params.get("where") === "any";
  params.delete("asked");
  params.delete("notice");
  params.delete("where");
  await ensureFresh();
  const parsed = parseFilterParams(params);
  const asGiven = parsed.ok ? parsed.filters : {};
  // Without a place in the search, it opens on the visitor's city (one tap shows everywhere).
  const here = await getHere();
  const local = !anywhere && !asked && !saysWhere(asGiven) && here.city ? here.city : null;
  const filters: SearchFilters = local ? { ...asGiven, city: local.id } : asGiven;
  const result = searchEvents(filters);
  const interp = asked ? parseQuery(asked, {}) : null;
  const cityName = filters.city ? getDestination(filters.city)?.name : undefined;
  const everywhere = new URLSearchParams(params);
  everywhere.delete("page");
  everywhere.set("where", "any");

  return (
    <>
      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-5 sm:pt-8">
        <div className="mb-4 sm:mb-6">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h1 className="t-display">
                {asked || filters.q ? (
                  <>Results for <em>“{asked ?? filters.q}”</em></>
                ) : filters.near ? (
                  filters.nearLabel === "Near you" ? <>Events <em>near you</em></> : <>Events near <em>{filters.nearLabel?.split(",")[0] ?? "the selected point"}</em></>
                ) : cityName ? (
                  <>What&apos;s on in <em>{cityName}</em></>
                ) : (
                  <>Everything, <em>everywhere</em></>
                )}
              </h1>
              {(filters.near || filters.tFrom || filters.from) && <p className="t-small text-text-3 mt-2">{summarizeSearch(filters).text}. Times are local to each venue.</p>}
            </div>
            <Link href="/studio/new" className="btn btn-secondary btn-sm press max-sm:hidden">＋ List your event</Link>
          </div>
          <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-2.5">
            <HerePill here={here} label={local ? "Near" : undefined} />
            {local ? (
              <Link href={`/events?${everywhere}`} className="t-small text-text-2 hover:text-text underline-offset-4 hover:underline">See everywhere</Link>
            ) : (
              <p className="t-small text-text-2 max-sm:hidden">Every category, every city, in one search.</p>
            )}
          </div>
        </div>
        <div className="grid gap-2 mb-4">
          {!parsed.ok && <Notice>Some filters in this link were invalid and have been ignored.</Notice>}
          {notice && NOTICES[notice] && <Notice>{NOTICES[notice]}</Notice>}
          {interp && interp.ambiguities.length > 0 && (
            <Notice>
              {interp.ambiguities.map((a) => (
                <span key={a} className="block">{a}</span>
              ))}
            </Notice>
          )}
        </div>
        <Suspense fallback={null}>
          <ContinueSearch />
        </Suspense>
        <EventsBrowser result={result} filters={filters} facets={result.facets} implicitCity={here.city && filters.city === here.city.id ? here.city.id : undefined} anywhere={anywhere} suggestion={!result.total && filters.q ? didYouMean(filters.q) : undefined} />
      </main>
      {/* A server that had only just started: the rest of the catalogue is on its way. */}
      <StillLoading partial={!catalogueComplete()} count={dataSummary().total} />
      <Footer />
    </>
  );
}
