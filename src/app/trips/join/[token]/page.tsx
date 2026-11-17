import type { Metadata } from "next";
import { JoinTrip } from "@/components/trips/join-trip";

// An invitation: private, never indexed, never kept by a shared cache.
export const metadata: Metadata = { title: "You're invited to a trip", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JoinTrip invite={/^[A-Za-z0-9_-]{24}$/.test(token) ? token : "invalid-token-xxxxxxxxxx"} />;
}
