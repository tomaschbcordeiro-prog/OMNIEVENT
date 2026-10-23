import type { Metadata } from "next";
import Link from "next/link";
import { ensureFresh, getOffer, getEventView } from "@/lib/store";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Demo ticket offer", robots: { index: false } };

/** Where demo "buy" links land: explains what would happen with a real provider. No fake checkout. */
export default async function DemoTicket({ searchParams }: { searchParams: Promise<{ offer?: string }> }) {
  const { offer: id } = await searchParams;
  await ensureFresh();
  const offer = id ? getOffer(id) : undefined;
  const ev = offer ? getEventView(offer.eventId) : undefined;
  return (
    <main className="mx-auto max-w-xl px-4 sm:px-6 pt-16 pb-24">
      <span className="demo-badge">Demo</span>
      <h1 className="t-h1 mt-3">This is where you&apos;d go to the seller</h1>
      <p className="t-body text-text-2 mt-3">
        {offer ? (
          <>
            You chose the {formatMoney(offer.totalPrice ?? offer.basePrice ?? 0, offer.currency)} offer from <strong className="text-text">{offer.provider}</strong>
            {ev ? <> for <strong className="text-text">{ev.title}</strong></> : null}. {offer.provider} is a fictional seller, so there is nothing to buy.
          </>
        ) : (
          <>This demo offer has expired (demo data is regenerated daily).</>
        )}
      </p>
      <p className="t-body text-text-2 mt-3">
        With a real provider connected, this button opens the seller&apos;s official page in a new tab. OMNIEVENT never takes payment details and never says a ticket was bought unless the seller confirms it.
      </p>
      <div className="mt-6 flex gap-2">
        {ev && <Link href={`/events/${ev.slug}`} className="btn btn-primary">Back to the event</Link>}
        <Link href="/about/data" className="btn btn-secondary">How data and tickets work</Link>
      </div>
    </main>
  );
}
