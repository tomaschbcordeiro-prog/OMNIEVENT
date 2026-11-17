import type { Metadata } from "next";
import Link from "next/link";
import { Bookmark, ChevronDown, Search, Ticket } from "lucide-react";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Help: how Mundivi works",
  description: "How to find events, save them, get tickets and plan a trip on Mundivi, in a few plain answers.",
  alternates: { canonical: "/help" },
};

/** The whole idea in three steps, each with the place to try it. */
const STEPS = [
  { Icon: Search, title: "Find", body: "Search for anything (a band, a team, a city, “free this weekend”) or tap a glowing dot on the globe.", href: "/events", cta: "See what's on" },
  { Icon: Bookmark, title: "Save", body: "Tap the bookmark on any event. No account needed: your saved events wait for you in My World.", href: "/my-world", cta: "Open My World" },
  { Icon: Ticket, title: "Go", body: "Tap Tickets to buy from the official seller. We never sell tickets or take a cut.", href: "/about", cta: "About Mundivi" },
];

/** Questions people ask, answered in a sentence or two, each pointing to where to do it. */
const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What's on near me tonight?",
    a: (
      <>
        Open <Link href="/events">Events</Link> and tap <b>Near me</b>, then <b>Tonight</b>. On the <Link href="/">globe</Link>, <b>Live now</b> shows what has already started.
      </>
    ),
  },
  {
    q: "How do I buy tickets?",
    a: (
      <>
        On an event, tap <b>Tickets</b>. It opens the official seller&apos;s page, where you pay. Prices on Mundivi are the ones the seller advertises and can change, so the seller&apos;s page always has the final price.
      </>
    ),
  },
  {
    q: "Do I need an account?",
    a: (
      <>
        No. Searching, saving events, trips and saved searches all work without one, and they stay on this device. An account is only for the <Link href="/community">community</Link> and <Link href="/clubs">clubs</Link>: posting, rating and seeing who&apos;s going.
      </>
    ),
  },
  {
    q: "Is it free?",
    a: <>Yes. Finding, saving and planning are free, and so is adding your own event in <Link href="/studio">Studio</Link>.</>,
  },
  {
    q: "How do I save an event?",
    a: (
      <>
        Tap the bookmark on the event. On a phone you can also swipe an event to the left in a list. Tap it again (or swipe again) to take it out; you&apos;ll always get a moment to undo.
      </>
    ),
  },
  {
    q: "Can I put my saved events in my calendar?",
    a: (
      <>
        Yes. In <Link href="/my-world">My World</Link>, open <b>Calendar</b> to download every upcoming saved event in one file for Google, Apple or Outlook calendars.
      </>
    ),
  },
  {
    q: "How do I plan a trip?",
    a: (
      <>
        Go to <Link href="/trips">Trips</Link> and tap <b>Plan a trip</b>: choose the cities and dates, and the events on during your stay show up on the way. No ideas yet? Browse <Link href="/trips/ideas">Trip ideas</Link> and make one yours.
      </>
    ),
  },
  {
    q: "How do I put Mundivi on my phone like an app?",
    a: (
      <>
        On Android, tap <b>More</b> at the bottom, then <b>Install the app</b>. On iPhone, open the site in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>. It opens full screen, and pages you&apos;ve visited open even without internet.
      </>
    ),
  },
  {
    q: "How do I add my own event?",
    a: (
      <>
        Open <Link href="/studio">Studio</Link> and tap <b>Create an event</b>. You can paste an announcement and the form fills itself in.
      </>
    ),
  },
  {
    q: "What are Match, Mixtape and Clubs?",
    a: (
      <>
        <Link href="/match">Match</Link>: say what you fancy and swipe through events, right to save. <Link href="/mixtape">Mixtape</Link>: pick a city and a vibe, and get a weekend planned in order. <Link href="/clubs">Clubs</Link>: small groups who go out together and vote on what to see.
      </>
    ),
  },
  {
    q: "Where do the events come from? One is missing or wrong.",
    a: (
      <>
        From official sources: city agendas, venue calendars, culture portals and ticket sellers, refreshed automatically. Every event links to its original listing, which is always right if something differs. No source covers everything, so a missing event may still be happening. <Link href="/about/data">How our data works</Link>.
      </>
    ),
  },
  {
    q: "How do I see or delete what Mundivi keeps about me?",
    a: (
      <>
        In <Link href="/my-world">My World</Link>, the account part lets you download everything as a file or delete it. Saved events live on this device, so clearing the browser&apos;s data also removes them.
      </>
    ),
  },
  {
    q: "Are there keyboard shortcuts?",
    a: (
      <>
        Yes, on a computer: <kbd className="kbd">/</kbd> to search, <kbd className="kbd">?</kbd> for the full list, and <kbd className="kbd">g</kbd> then a letter to go somewhere (<kbd className="kbd">g</kbd> <kbd className="kbd">e</kbd> for Events).
      </>
    ),
  },
];

export default function HelpPage() {
  return (
    <>
      <main id="main" className="mx-auto max-w-3xl px-4 sm:px-6 pt-10 pb-6">
        <p className="t-small font-semibold text-text-3">Help</p>
        <h1 className="t-h1 mt-1">How Mundivi <em>works</em></h1>
        <p className="t-lede text-text-2 mt-3 measure">Everything that&apos;s on, anywhere on Earth: find it, save it, go. Here&apos;s how, in plain words.</p>

        <ol className="mt-8 grid gap-3 sm:grid-cols-3">
          {STEPS.map(({ Icon, title, body, href, cta }, i) => (
            <li key={title} className="surface rounded-[var(--radius-l)] p-5 flex flex-col">
              <span className="help-step" aria-hidden>
                <Icon size={18} />
              </span>
              <h2 className="t-h3 mt-3">
                <span className="sr-only">Step {i + 1}: </span>
                {title}
              </h2>
              <p className="t-body text-text-2 mt-1 flex-1">{body}</p>
              <Link href={href} className="btn btn-secondary btn-sm mt-4 self-start">{cta}</Link>
            </li>
          ))}
        </ol>

        <h2 className="t-h2 mt-12">Questions people ask</h2>
        <div className="help-faq mt-3">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="help-q">
              <summary>
                <span>{q}</span>
                <ChevronDown size={18} aria-hidden className="help-chev" />
              </summary>
              <div className="help-a t-body text-text-2">{a}</div>
            </details>
          ))}
        </div>

        <p className="t-small text-text-3 mt-10">Still stuck? Ask in the <Link href="/community" className="underline underline-offset-2 hover:text-text">community</Link>.</p>
      </main>
      <Footer />
    </>
  );
}
