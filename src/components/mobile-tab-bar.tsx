"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bookmark, CalendarDays, ChevronRight, Disc3, Download, Heart, Menu, Moon, Search, Share, Sparkles, Sun, X } from "lucide-react";
import { installApp, useInstall } from "./app-shell";
import { MundiviMark } from "./brand";
import { useUser } from "@/lib/user/store";
import { SearchBox } from "./search-box";
import { ThemeToggle } from "./theme-toggle";
import { COMMUNITY, EXTRA, HELP, TRIPS, type NavItem } from "./nav-items";

/** The site's own mark (a planet with one event lit up), drawn large for the bar's middle button. */
function GlobeMark({ size = 30 }: { size?: number }) {
  return <MundiviMark size={size} ring="#fff" className="tab-globe-mark" />;
}

/** Trips and the community first (they have no tab of their own), then the rest. */
const MORE: NavItem[] = [TRIPS, COMMUNITY, ...EXTRA];

/** One tap to what people look for most (read as plain words by the search). */
const QUICK: { q: string; label: string; Icon: typeof Heart }[] = [
  { q: "tonight", label: "Tonight", Icon: Moon },
  { q: "this weekend", label: "This weekend", Icon: Sun },
  { q: "free this week", label: "Free", Icon: Sparkles },
  { q: "live music this weekend", label: "Live music", Icon: Disc3 },
  { q: "for kids this weekend", label: "With kids", Icon: Heart },
];

/** Tapping the tab of the page you're on takes you back to its top, as apps do. */
function backToTop(e: React.MouseEvent) {
  if (window.scrollY < 4) return;
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

/**
 * Phones and tablets: the site's main places one thumb away, at the bottom of the screen.
 * The globe sits raised in the middle (the site's heart); tapped on the globe page it brings
 * the whole planet back into view. "More" opens everything else.
 */
export function MobileTabBar() {
  const path = usePathname();
  const user = useUser();
  const [sheet, setSheet] = useState<null | "more" | "search">(null);
  const isHome = path === "/";
  const on = (href: string) => (href === "/" ? isHome : path.startsWith(href));
  // In the More sheet, only the closest match is marked (Trip ideas, not Trips as well).
  const here = (href: string) => on(href) && !MORE.some((m) => m.href !== href && m.href.startsWith(href) && on(m.href));
  const saved = user.saved.length;
  const install = useInstall();
  const [howTo, setHowTo] = useState(false);

  // A new page closes whatever was open.
  const last = useRef(path);
  useEffect(() => {
    if (last.current !== path) setSheet(null);
    last.current = path;
  }, [path]);
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  const search = () => {
    // On the globe page its own search field is right there.
    const box = isHome ? [...document.querySelectorAll<HTMLInputElement>("input[data-search-input]")].find((el) => el.offsetParent !== null) : null;
    if (box) {
      setSheet(null);
      box.focus();
      return;
    }
    setSheet((s) => (s === "search" ? null : "search"));
  };

  return (
    <>
      <nav className="tabbar lg:hidden" aria-label="Main">
        <Link href="/events" className="tab" aria-current={on("/events") ? "page" : undefined} onClick={(e) => path === "/events" && backToTop(e)}>
          <CalendarDays size={21} aria-hidden />
          <span>Events</span>
        </Link>
        <button type="button" className="tab" aria-expanded={sheet === "search"} onClick={search}>
          <Search size={21} aria-hidden />
          <span>Search</span>
        </button>
        <Link
          href="/"
          className="tab tab-globe"
          aria-current={isHome ? "page" : undefined}
          aria-label={isHome ? "Globe: back to the whole planet" : "Globe: explore the planet"}
          onClick={(e) => {
            setSheet(null);
            if (isHome) {
              e.preventDefault();
              window.dispatchEvent(new Event("omni:globe"));
            }
          }}
        >
          <span className="tab-globe-disc">
            <GlobeMark />
          </span>
          <span>Globe</span>
        </Link>
        <Link href="/my-world" className="tab" aria-current={on("/my-world") ? "page" : undefined} onClick={(e) => path === "/my-world" && backToTop(e)} aria-label={saved ? `Saved: ${saved} ${saved === 1 ? "event" : "events"}` : "Saved"}>
          <span className="relative">
            <Bookmark size={21} aria-hidden />
            {saved > 0 && <span className="tab-badge tnum">{saved > 99 ? "99+" : saved}</span>}
          </span>
          <span>Saved</span>
        </Link>
        <button type="button" className="tab" aria-expanded={sheet === "more"} onClick={() => setSheet((s) => (s === "more" ? null : "more"))}>
          {sheet === "more" ? <X size={21} aria-hidden /> : <Menu size={21} aria-hidden />}
          <span>More</span>
        </button>
      </nav>

      {sheet && <button type="button" className="tab-backdrop lg:hidden" aria-label="Close" tabIndex={-1} onClick={() => setSheet(null)} />}
      {sheet === "more" && (
        <section className="tab-sheet lg:hidden panel-in" role="dialog" aria-modal="true" aria-label="More of Mundivi">
          <ul className="grid grid-cols-2 gap-2">
            {MORE.map(({ href, label, note, Icon, fresh }) => (
              <li key={href}>
                <Link href={href} className="tab-tile press" aria-current={here(href) ? "page" : undefined} onClick={() => setSheet(null)}>
                  <Icon size={20} aria-hidden className="text-cyan shrink-0" />
                  <span className="min-w-0">
                    <span className="block font-semibold leading-tight">{label}{fresh && <span className="tab-new">New</span>}</span>
                    <span className="block t-micro text-text-2 line-clamp-2">{note}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {(install.canPrompt || install.ios) && (
            <div className="mt-2">
              <button
                type="button"
                className="tab-install press"
                aria-expanded={install.ios ? howTo : undefined}
                onClick={() => (install.canPrompt ? void installApp().then((ok) => ok && setSheet(null)) : setHowTo((h) => !h))}
              >
                <span className="tab-install-icon" aria-hidden><Download size={18} /></span>
                <span className="min-w-0 text-left">
                  <span className="block font-semibold leading-tight">Install the app</span>
                  <span className="block t-micro text-text-2">On your home screen, full screen, works offline</span>
                </span>
              </button>
              {install.ios && howTo && (
                <ol className="tab-install-how t-small">
                  <li>Tap <Share size={14} aria-label="Share" className="inline -mt-0.5" /> at the bottom of Safari.</li>
                  <li>Choose <b>Add to Home Screen</b>.</li>
                  <li>Tap <b>Add</b>. Mundivi opens like an app.</li>
                </ol>
              )}
            </div>
          )}
          <div className="mt-3 pt-2 border-t border-line flex items-center justify-between gap-3">
            <Link href={HELP.href} className="tab-help press" aria-current={on(HELP.href) ? "page" : undefined} onClick={() => setSheet(null)}>
              <HELP.Icon size={18} aria-hidden className="text-cyan shrink-0" />
              <span className="font-semibold">Help</span>
              <span className="t-micro text-text-3 truncate">{HELP.note}</span>
              <ChevronRight size={15} aria-hidden className="text-text-3 shrink-0" />
            </Link>
            <ThemeToggle className="border border-line-strong shrink-0" />
          </div>
        </section>
      )}
      {sheet === "search" && (
        <section className="tab-sheet tab-sheet--top lg:hidden panel-in" role="dialog" aria-modal="true" aria-label="Search">
          <ul className="tab-quick no-scrollbar mb-2.5" aria-label="Quick picks">
            {QUICK.map(({ q, label, Icon }) => (
              <li key={q}>
                <Link href={`/search?q=${encodeURIComponent(q)}`} className="chip chip-link press" onClick={() => setSheet(null)}>
                  <Icon size={14} aria-hidden /> {label}
                </Link>
              </li>
            ))}
          </ul>
          <SearchBox autoFocus placeholder="Events, artists, venues, cities…" />
        </section>
      )}
    </>
  );
}
