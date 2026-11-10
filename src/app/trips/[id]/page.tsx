import type { Metadata } from "next";
import { Suspense } from "react";
import { TripView } from "@/components/trips/trip-view";

export const metadata: Metadata = { title: "Your trip", robots: { index: false, follow: false } };

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="trip-stage"><div className="trip-globe-loading" /></div>}>
      <TripView id={id} />
    </Suspense>
  );
}
