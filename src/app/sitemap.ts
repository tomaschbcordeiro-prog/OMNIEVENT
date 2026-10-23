import type { MetadataRoute } from "next";
import { ensureFresh, allSlugs } from "@/lib/store";
import { ALL_DESTINATIONS } from "@/lib/destinations";
import { GROUPS } from "@/lib/categories";

export const dynamic = "force-dynamic";
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/** Only real (non-demo) events, venues and participants are listed. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await ensureFresh();
  const s = allSlugs();
  const now = new Date();
  return [
    ...["", "/events", "/categories", "/destinations", "/about/data"].map((p) => ({ url: `${SITE}${p}`, lastModified: now })),
    ...GROUPS.map((g) => ({ url: `${SITE}/categories/${g.slug}`, lastModified: now })),
    ...ALL_DESTINATIONS.map((d) => ({ url: `${SITE}/destinations/${d.slug}`, lastModified: now })),
    ...s.events.slice(0, 40000).map((slug) => ({ url: `${SITE}/events/${slug}`, lastModified: now })),
    ...s.venues.slice(0, 5000).map((slug) => ({ url: `${SITE}/venues/${slug}`, lastModified: now })),
    ...s.participants.slice(0, 5000).map((slug) => ({ url: `${SITE}/participants/${slug}`, lastModified: now })),
  ];
}
