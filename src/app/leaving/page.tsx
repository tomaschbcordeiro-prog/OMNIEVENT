import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, ShieldAlert } from "lucide-react";
import { ensureFresh, getEventView, getOffer } from "@/lib/store";
import { Footer } from "@/components/footer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leaving OMNIEVENT", robots: { index: false, follow: false } };

/**
 * A ticket or sign-up link a member added to their own listing: shown before following it, with
 * where it leads, so OMNIEVENT's address can't be used to disguise another site.
 */
export default async function LeavingPage({ searchParams }: { searchParams: Promise<{ offer?: string }> }) {
  const { offer: id } = await searchParams;
  await ensureFresh();
  const offer = id ? getOffer(id) : undefined;
  const url = offer?.purchaseUrl && /^https:\/\//.test(offer.purchaseUrl) ? new URL(offer.purchaseUrl) : undefined;
  const event = offer ? getEventView(offer.eventId) : undefined;
  return (
    <>
      <main id="main" className="mx-auto max-w-[560px] px-4 sm:px-6 py-16">
        <div className="surface rounded-[var(--radius-l)] p-6 sm:p-8">
          <ShieldAlert size={28} className="text-warn" aria-hidden />
          {url ? (
            <>
              <h1 className="t-h2 mt-3">You&apos;re leaving OMNIEVENT</h1>
              <p className="t-body text-text-2 mt-2">
                This link was added by the member who listed {event ? <strong className="text-text">{event.title}</strong> : "this event"}
                {offer?.provider ? <> (organised by {offer.provider})</> : null}. We haven&apos;t checked the site it leads to.
              </p>
              <p className="mt-4 rounded-[var(--radius-m)] bg-panel-2 px-4 py-3 font-mono text-[14px] break-all">
                <span className="text-text-3">{`${url.protocol}//`}</span>
                <strong>{url.hostname}</strong>
                <span className="text-text-3">{url.pathname.length > 1 ? url.pathname : ""}</span>
              </p>
              <p className="t-small text-text-2 mt-3">Only pay on a site you trust. OMNIEVENT never asks for payment details.</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <a href={url.toString()} rel="noopener noreferrer nofollow" className="btn btn-primary">
                  Continue to {url.hostname} <ExternalLink size={15} aria-hidden />
                </a>
                {event && <Link href={`/events/${event.slug}`} className="btn btn-secondary">Back to the event</Link>}
              </div>
            </>
          ) : (
            <>
              <h1 className="t-h2 mt-3">This link isn&apos;t available</h1>
              <p className="t-body text-text-2 mt-2">The listing may have changed or been removed.</p>
              <Link href="/events" className="btn btn-secondary mt-6">Browse events</Link>
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
