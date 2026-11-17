import type { Metadata } from "next";
import { OfflineView } from "@/components/offline-view";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

/** What the app shows on a page it has never opened, without a network. */
export default function OfflinePage() {
  return <OfflineView />;
}
