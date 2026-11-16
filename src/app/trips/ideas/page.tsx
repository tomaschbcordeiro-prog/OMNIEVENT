import type { Metadata } from "next";
import { TripIdeasFeed } from "@/components/trips/trip-ideas";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Trip ideas",
  description: "Endless trip ideas round the world: coasts, mountains, wine, old towns, islands and big cities, for a weekend, a week or longer. Pick one and make it yours.",
  alternates: { canonical: "/trips/ideas" },
};

export default function TripIdeasPage() {
  return (
    <>
      <TripIdeasFeed />
      <Footer />
    </>
  );
}
