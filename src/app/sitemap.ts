import type { MetadataRoute } from "next";
import { ensureFresh, allSlugs } from "@/lib/store";
import { ALL_DESTINATIONS } from "@/lib/destinations";
import { GROUPS } from "@/lib/categories";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic";

/** Only real (non-demo) events, venues and participants are listed. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await ensureFresh();
  const s = allSlugs();
  const now = new Date();
  const fixed = [
    ...["", "/events", "/categories", "/destinations", "/mixtape", "/about/data"].map((p) => ({ url: `${SITE}${p}`, lastModified: now })),
    ...GROUPS.map((g) => ({ url: `${SITE}/categories/${g.slug}`, lastModified: now })),
    ...ALL_DESTINATIONS.map((d) => ({ url: `${SITE}/destinations/${d.slug}`, lastModified: now })),
    ...s.venues.slice(0, 5000).map((slug) => ({ url: `${SITE}/venues/${slug}`, lastModified: now })),
    ...s.participants.slice(0, 5000).map((slug) => ({ url: `${SITE}/participants/${slug}`, lastModified: now })),
  ];
  // Search engines read at most 50,000 addresses from one sitemap: events fill what's left.
  return [...fixed, ...s.events.slice(0, Math.max(0, 50000 - fixed.length)).map((slug) => ({ url: `${SITE}/events/${slug}`, lastModified: now }))];
}
