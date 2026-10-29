import type { Metadata } from "next";
import { ensureFresh, searchEvents } from "@/lib/store";
import { parseFilterParams } from "@/lib/search/params";
import { parseQuery } from "@/lib/search/parse";
import { EventsBrowser } from "@/components/events-browser";
import { Footer } from "@/components/footer";
import { Notice } from "@/components/ui";
import { getDestination } from "@/lib/destinations";
import { Suspense } from "react";
import { ContinueSearch } from "@/components/continue-search";
import { summarizeSearch } from "@/lib/search/summary";

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
  params.delete("asked");
  params.delete("notice");
  await ensureFresh();
  const parsed = parseFilterParams(params);
  const filters = parsed.ok ? parsed.filters : {};
  const result = searchEvents(filters);
  const interp = asked ? parseQuery(asked, {}) : null;

  return (
    <>
      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-8">
        <div className="mb-6">
          <h1 className="t-h1">{asked ? `Results for “${asked}”` : filters.near ? `Events near ${filters.nearLabel?.split(",")[0] ?? "the selected point"}` : "All events"}</h1>
          {(filters.near || filters.tFrom || filters.from) && <p className="t-small text-text-3 mt-1">{summarizeSearch(filters).text}. Times are local to each venue.</p>}
          <p className="t-lede text-text-2 mt-2">
            Every category in one search. Prices are what sellers advertise; we show whether fees are included when the seller tells us.
          </p>
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
        <EventsBrowser result={result} filters={filters} facets={result.facets} />
      </main>
      <Footer />
    </>
  );
}
