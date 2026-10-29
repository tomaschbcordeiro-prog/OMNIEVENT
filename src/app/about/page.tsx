import type { Metadata } from "next";
import Link from "next/link";
import { Globe2, Search, Heart, Users, Ticket, Database } from "lucide-react";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "About OMNIEVENT",
  description: "What OMNIEVENT is: one place to find concerts, sport, theatre, festivals, exhibitions and more anywhere on Earth, with links straight to the official sellers.",
  alternates: { canonical: "/about" },
};

const WAYS = [
  { icon: Globe2, title: "Spin the globe", body: "Every glowing marker is a place with events. Tap one, or travel day by day with the timeline.", href: "/", cta: "Open the globe" },
  { icon: Search, title: "Search and filter", body: "By category, city, dates, local times, price or free entry. Only what you ask for comes back.", href: "/events", cta: "Browse events" },
  { icon: Heart, title: "Swipe a plan", body: "Say what you fancy, like jazz in Lisbon or comedy in Madrid, then swipe events one at a time.", href: "/match", cta: "Try Event Match" },
  { icon: Users, title: "Go together", body: "Rate shows and venues, ask questions before you go, and see who else is going.", href: "/community", cta: "Visit the community" },
];

export default function AboutPage() {
  return (
    <>
      <main className="mx-auto max-w-5xl px-4 sm:px-6 pt-10 pb-6">
        <p className="t-small font-semibold text-text-3">About</p>
        <h1 className="t-h1 mt-1 max-w-[22ch]">Every event on Earth, in one place</h1>
        <p className="t-lede text-text-2 mt-3">
          OMNIEVENT gathers concerts, sport, theatre, festivals, exhibitions, talks and family days from official sources around the world, so you can find what&apos;s on anywhere, on any date, without opening twenty sites.
        </p>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {WAYS.map((w) => (
            <li key={w.title} className="surface rounded-[var(--radius-l)] p-5 flex flex-col">
              <w.icon size={22} className="text-text-2" aria-hidden />
              <h2 className="t-h3 mt-3">{w.title}</h2>
              <p className="t-body text-text-2 mt-1 flex-1">{w.body}</p>
              <Link href={w.href} className="btn btn-secondary mt-4 self-start">{w.cta}</Link>
            </li>
          ))}
        </ul>

        <div className="mt-12 grid gap-8 md:grid-cols-2">
          <section>
            <h2 className="t-h2 flex items-center gap-2"><Ticket size={20} aria-hidden className="text-text-2" /> Tickets</h2>
            <p className="t-body text-text-2 mt-2 measure">
              We don&apos;t sell tickets or take payments. Each event links to its official seller, and where several sellers list it we show their advertised prices side by side, saying whether fees are included when the seller tells us.
            </p>
          </section>
          <section>
            <h2 className="t-h2 flex items-center gap-2"><Database size={20} aria-hidden className="text-text-2" /> Where the data comes from</h2>
            <p className="t-body text-text-2 mt-2 measure">
              City agendas, venue calendars, national culture portals and ticket sellers, refreshed automatically. Every listing keeps a link to its source. No source covers everything, so a missing event doesn&apos;t mean it isn&apos;t happening.
            </p>
            <Link href="/about/data" className="btn btn-ghost mt-2 -ml-3">How our data works →</Link>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
