import type { Metadata } from "next";
import { ensureFresh, providerStatuses, dataSummary } from "@/lib/store";
import { FX_SOURCE } from "@/lib/currency";
import { relativeTime } from "@/lib/format";
import { Footer } from "@/components/footer";
import { Tone } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "How our data works", alternates: { canonical: "/about/data" } };

export default async function DataPage() {
  await ensureFresh();
  const providers = providerStatuses();
  const s = dataSummary();
  return (
    <>
      <main className="mx-auto max-w-3xl px-4 sm:px-6 pt-10">
        <h1 className="t-h1">How our data works</h1>
        <div className="t-body text-text-2 mt-4 grid gap-4 measure">
          <p>OMNIEVENT doesn&apos;t make up events. Every listing comes from a connected source, keeps a link back to it, and shows when it was last updated. Sources refresh automatically on a schedule.</p>
          <p>No single source covers every event on Earth. Coverage grows as more licensed sources are connected, so an event missing here doesn&apos;t mean it isn&apos;t happening.</p>
          <p>Ticket prices are what sellers advertise. We say whether fees are included only when the seller tells us, and we never compare a fee-inclusive price with one that excludes fees as if they were the same. We don&apos;t sell tickets: you buy from the seller.</p>
          <p>When no real source is connected, OMNIEVENT runs on fictional demo data. Every demo listing carries a yellow Demo badge and is hidden from search engines.</p>
        </div>

        <h2 className="t-h2 mt-10">Sources</h2>
        <p className="t-small text-text-3 tnum mt-1">{s.live.toLocaleString()} live and {s.demo.toLocaleString()} demo listings currently loaded.</p>
        <ul className="mt-4 grid gap-3">
          {providers.map((p) => (
            <li key={p.id} className="rounded-[var(--radius-m)] border border-line p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{p.name}</span>
                {p.enabled ? <Tone tone="ok">Active</Tone> : p.configured ? <Tone tone="muted">Configured, inactive</Tone> : <Tone tone="muted">Not configured</Tone>}
                {p.isDemo && <span className="demo-badge">Demo</span>}
              </div>
              <p className="t-small text-text-2 mt-1">{p.coverage}</p>
              {p.lastRun && (
                <p className="t-micro text-text-3 mt-2 tnum">
                  Last sync {relativeTime(p.lastRun.startedAt)}: {p.lastRun.ok ? "succeeded" : "failed"}, {p.lastRun.imported + p.lastRun.updated} records{p.lastRun.failures ? `, ${p.lastRun.failures} failures` : ""}{p.lastRun.rateLimited ? ", rate-limited" : ""}
                  {p.lastRun.error && <span className="block text-bad">{p.lastRun.error}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>

        <h2 className="t-h2 mt-10">Currency estimates</h2>
        <p className="t-body text-text-2 mt-2 measure">
          Converted amounts (marked ≈) use the {FX_SOURCE.name.toLowerCase()} dated {FX_SOURCE.asOf}. They&apos;re for orientation only. The seller&apos;s own price and currency always come first.
        </p>
      </main>
      <Footer />
    </>
  );
}
