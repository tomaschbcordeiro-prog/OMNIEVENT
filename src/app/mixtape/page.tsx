import type { Metadata } from "next";
import { ensureFresh, cityStats } from "@/lib/store";
import { CITIES, getDestination } from "@/lib/destinations";
import { parseTapeQuery, tapeQuery } from "@/lib/mixtape/share";
import { tapeName } from "@/lib/mixtape/plan";
import { MixtapeStudio, type MixCity } from "@/components/mixtape/mixtape-studio";
import { getHere } from "@/lib/here";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

const DESCRIPTION = "Plan a night or a weekend in any city like a mixtape: real events in order, with time to get between them. Shuffle, lock what you love, play it on the map and share it.";

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const link = parseTapeQuery(await searchParams);
  const city = link ? getDestination(link.city) : undefined;
  if (!link?.tracks.length || !city) return { title: "Mixtape: your weekend, on tape", description: DESCRIPTION, alternates: { canonical: "/mixtape" } };
  const name = link.name ?? tapeName(city.name, link.vibe, city.id.length);
  const image = `/api/mixtape/card?${tapeQuery(link)}`;
  const description = `A mixtape of ${link.tracks.length} event${link.tracks.length === 1 ? "" : "s"} in ${city.name}. Play it, remix it, go.`;
  return {
    title: `${name} · Mixtape`,
    description,
    alternates: { canonical: "/mixtape" },
    // A shared tape is somebody's plan, not a page for search results.
    robots: { index: false, follow: true },
    openGraph: { title: name, description, images: [{ url: image, width: 1200, height: 630, alt: `${name}: a mixtape for ${city.name}` }] },
    twitter: { card: "summary_large_image", title: name, description, images: [image] },
  };
}

export default async function MixtapePage({ searchParams }: { searchParams: SP }) {
  await ensureFresh();
  const stats = cityStats();
  const sp = await searchParams;
  const link = parseTapeQuery(sp);
  // "?w=tonight" alone (from the command menu): that window, in the visitor's city.
  const w = typeof sp.w === "string" && ["tonight", "tomorrow", "weekend", "next-weekend"].includes(sp.w) ? (sp.w as "tonight" | "tomorrow" | "weekend" | "next-weekend") : undefined;
  const toCity = (c: (typeof CITIES)[number]): MixCity => ({ id: c.id, name: c.name, country: c.country ?? "", tz: c.timeZone ?? "UTC", currency: c.currency ?? "EUR", lat: c.lat, lng: c.lng, n: stats[c.id]?.total ?? 0 });
  // Cities with enough on to make a tape, busiest first (plus the one a shared tape is from).
  const cities = CITIES.filter((c) => (stats[c.id]?.total ?? 0) >= 8 || c.id === link?.city)
    .map(toCity)
    .sort((a, b) => b.n - a.n)
    .slice(0, 400);
  const here = await getHere();
  return <MixtapeStudio cities={cities} link={link} when={w} here={here.city ? { id: here.city.id, chosen: here.source === "chosen" || here.source === "gps" } : null} />;
}
