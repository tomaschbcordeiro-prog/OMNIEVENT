import { DiscoverClient } from "@/components/discover/discover-client";
import { ensureFresh, dataSummary } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  await ensureFresh();
  const s = dataSummary();
  return (
    <main>
      <DiscoverClient dataSummary={{ demo: s.demo, live: s.live }} />
    </main>
  );
}
