import type { Metadata } from "next";
import { TripIdeasFeed } from "@/components/trips/trip-ideas";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Trip ideas",
  description: "Endless trip ideas round the world: coasts, mountains, wine, old towns, islands and big cities, for a weekend, a week or longer. Pick one and make it yours.",
  alternates: { canonical: "/trips/ideas" },
};

// Today's ideas: the page is made again each hour, with the day's seed in it.
export const revalidate = 3600;

export default function TripIdeasPage() {
  return (
    <>
      <TripIdeasFeed seed={new Date().toISOString().slice(0, 10)} />
      <Footer />
    </>
  );
}
