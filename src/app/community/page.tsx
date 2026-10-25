import type { Metadata } from "next";
import { ensureFresh, searchEvents } from "@/lib/store";
import { Footer } from "@/components/footer";
import { CommunityHome } from "@/components/community/community-home";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Community: ratings, tips and people going",
  description: "See what people are saying about events, venues and performers, who is going where, and the best-rated places, live.",
  alternates: { canonical: "/community" },
};

export default async function CommunityPage() {
  await ensureFresh();
  // Something to start a conversation on: soon, with a picture, from different cities.
  const soon = searchEvents({ sort: "date", pageSize: 120, from: new Date().toISOString().slice(0, 10) }).items;
  const seen = new Set<string>();
  const starters = soon
    .filter((c) => c.imageUrl && !c.isDemo && !seen.has(c.city) && seen.add(c.city))
    .concat(soon.filter((c) => !c.imageUrl))
    .slice(0, 6);
  return (
    <>
      <CommunityHome starters={starters} />
      <Footer />
    </>
  );
}
