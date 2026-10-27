import { DiscoverClient } from "@/components/discover/discover-client";

// The globe's page renders at once; its events load from the API, so a server that is still
// loading data never holds up the first paint.
export default function DiscoverPage() {
  return (
    <main>
      <DiscoverClient />
    </main>
  );
}
