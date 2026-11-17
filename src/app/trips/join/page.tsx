import type { Metadata } from "next";
import { JoinTrip } from "@/components/trips/join-trip";

export const metadata: Metadata = { title: "Join a trip", robots: { index: false, follow: false } };

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  return <JoinTrip initialCode={typeof code === "string" ? code.slice(0, 12) : ""} />;
}
