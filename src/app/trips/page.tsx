import type { Metadata } from "next";
import { TripsHome } from "@/components/trips/trips-home";
import { Footer } from "@/components/footer";
import { getHere } from "@/lib/here";
import { ideasPage } from "@/lib/travel/ideas";
import { ideaCards } from "@/lib/travel/idea-cards";

export const metadata: Metadata = {
  title: "Trips",
  description: "Plan a trip across cities and countries, see it on the globe, and pick the events on your dates.",
  alternates: { canonical: "/trips" },
};

export default async function TripsPage() {
  // Ready-made trips for someone with none yet: from their city when it's known, new each day.
  const here = await getHere();
  const seed = new Date().toISOString().slice(0, 10);
  const near = here.city ? { lat: here.city.lat, lng: here.city.lng } : undefined;
  const ideas = ideaCards(ideasPage(seed, 0, 3, near ? { near } : {}).ideas);
  const from = here.city ? { name: here.city.name, lat: here.city.lat, lng: here.city.lng } : undefined;
  return (
    <>
      <TripsHome ideas={ideas} from={from} />
      <Footer />
    </>
  );
}
