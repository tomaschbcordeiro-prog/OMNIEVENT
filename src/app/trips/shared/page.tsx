import type { Metadata } from "next";
import { SharedTripsList } from "@/components/trips/shared-trips";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Trips from travellers",
  description: "Trips people planned and shared: their routes, nights and the places they loved. Open one and make it yours.",
  alternates: { canonical: "/trips/shared" },
};

export default function SharedTripsPage() {
  return (
    <>
      <SharedTripsList />
      <Footer />
    </>
  );
}
