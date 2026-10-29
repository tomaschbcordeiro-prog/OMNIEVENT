import Link from "next/link";
import { providerStatuses, dataSummary } from "@/lib/store";
import { Logo } from "./header";

/** Every page states where its data comes from. */
export function Footer() {
  const providers = providerStatuses();
  const s = dataSummary();
  const active = providers.filter((p) => p.enabled);
  return (
    <footer className="border-t border-line mt-20">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-10 grid gap-8 md:grid-cols-[1.2fr_2fr]">
        <div>
          <Logo />
          <p className="t-small text-text-2 mt-3 measure">
            OMNIEVENT lists events from connected sources and links you to the seller. We don&apos;t sell tickets or take payments, and an event missing here doesn&apos;t mean it isn&apos;t happening.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-3 t-small">
          <nav aria-label="Explore">
            <p className="font-semibold mb-1">Explore</p>
            <ul className="text-text-2">
              {[
                ["/", "Discover"],
                ["/events", "All events"],
                ["/categories", "Categories"],
                ["/destinations", "Destinations"],
                ["/match", "Event Match"],
                ["/community", "Community"],
                ["/my-world", "My World"],
              ].map(([href, label]) => (
                <li key={href}><Link className="inline-block py-2.5 md:py-1.5 hover:text-text" href={href}>{label}</Link></li>
              ))}
            </ul>
          </nav>
          <nav aria-label="About">
            <p className="font-semibold mb-1">About</p>
            <ul className="text-text-2">
              <li><Link className="inline-block py-2.5 md:py-1.5 hover:text-text" href="/about">About OMNIEVENT</Link></li>
              <li><Link className="inline-block py-2.5 md:py-1.5 hover:text-text" href="/about/data">How our data works</Link></li>
            </ul>
          </nav>
          <div>
            <p className="font-semibold mb-1">Data</p>
            <p className="text-text-2 tnum py-1.5">
              {s.total ? `${s.live.toLocaleString()} live${s.demo ? ` and ${s.demo.toLocaleString()} demo` : ""} listings from ${active.length} sources.` : `Listings from ${active.length} sources.`}
            </p>
            {/* The full list is there for whoever wants it, without making every page end in a wall of text. */}
            <details className="group">
              <summary className="inline-flex items-center gap-1 py-1.5 cursor-pointer text-text-2 hover:text-text font-medium list-none">
                <span className="group-open:rotate-90 transition-transform" aria-hidden>›</span> See every source
              </summary>
              <ul className="mt-2 grid gap-2 text-text-2">
                {active.map((p) => (
                  <li key={p.id}>
                    <span className="text-text">{p.name}</span>
                    {p.isDemo && <span className="demo-badge ml-1.5">Demo</span>}
                    <span className="block t-micro text-text-3">{p.coverage}</span>
                    {p.attribution && <span className="block t-micro text-text-3">{p.attribution}</span>}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      </div>
    </footer>
  );
}
