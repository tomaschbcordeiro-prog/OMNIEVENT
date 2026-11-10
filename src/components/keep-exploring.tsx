import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

type Item = { href: string; label: string };

/**
 * The end of a page is never a dead end: a few named ways on, each saying exactly where it
 * goes ("Jazz in Lisbon", "Everything at Coliseu"), so the next step is one tap.
 */
export function KeepExploring({ links, title = "Keep exploring" }: { links: (Item | null | undefined | false | "")[]; title?: string }) {
  const seen = new Set<string>();
  const items = links.filter((l): l is Item => !!l && !seen.has(l.href) && !!seen.add(l.href));
  if (items.length < 2) return null;
  return (
    <nav className="keep-exploring mt-12" aria-label={title}>
      <h2 className="t-h3">{title}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {items.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="chip chip-link press">
              {l.label}
              <ArrowUpRight size={14} aria-hidden className="text-text-3" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
