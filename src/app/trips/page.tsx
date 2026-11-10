import type { Metadata } from "next";
import { TripsHome } from "@/components/trips/trips-home";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Trips",
  description: "Plan a trip across cities and countries, see it on the globe, and pick the events on your dates.",
  alternates: { canonical: "/trips" },
};

export default function TripsPage() {
  return (
    <>
      <TripsHome />
      <Footer />
    </>
  );
}
