import type { Metadata } from "next";
import { Suspense } from "react";
import { TripPlanner } from "@/components/trips/trip-planner";

export const metadata: Metadata = { title: "Plan a trip", robots: { index: false, follow: true } };

export default function NewTripPage() {
  return (
    <Suspense fallback={<div className="trip-stage"><div className="trip-globe-loading" /></div>}>
      <TripPlanner />
    </Suspense>
  );
}
