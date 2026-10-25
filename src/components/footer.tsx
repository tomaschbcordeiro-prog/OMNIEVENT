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
          <div>
            <p className="font-semibold mb-2">Explore</p>
            <ul className="grid gap-1.5 text-text-2">
              <li><Link className="hover:text-text" href="/">Discover</Link></li>
              <li><Link className="hover:text-text" href="/events">All events</Link></li>
              <li><Link className="hover:text-text" href="/categories">Categories</Link></li>
              <li><Link className="hover:text-text" href="/destinations">Destinations</Link></li>
              <li><Link className="hover:text-text" href="/community">Community</Link></li>
              <li><Link className="hover:text-text" href="/my-world">My World</Link></li>
            </ul>
          </div>
          <div className="sm:col-span-2">
            <p className="font-semibold mb-2">Data sources</p>
            <ul className="grid gap-2 text-text-2">
              {active.map((p) => (
                <li key={p.id}>
                  <span className="text-text">{p.name}</span>
                  {p.isDemo && <span className="demo-badge ml-1.5">Demo</span>}
                  <span className="block t-micro text-text-3">{p.coverage}</span>
                  {p.attribution && <span className="block t-micro text-text-3">{p.attribution}</span>}
                </li>
              ))}
            </ul>
            <p className="t-micro text-text-3 mt-3 tnum">
              {s.live.toLocaleString()} live and {s.demo.toLocaleString()} demo listings loaded. <Link href="/about/data" className="underline hover:text-text">How our data works</Link>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
