"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bookmark, CalendarDays, Disc3, Heart, MapPinned, Menu, MessagesSquare, Plane, Search, Sparkles, Users, X } from "lucide-react";
import { useUser } from "@/lib/user/store";
import { SearchBox } from "./search-box";
import { ThemeToggle } from "./theme-toggle";

/** The planet, the site's own mark, drawn large for the bar's middle button. */
function GlobeMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="tab-globe-mark">
      <circle cx="12" cy="12" r="10" fill="#1463FF" />
      <ellipse className="tab-globe-meridian" cx="12" cy="12" rx="4.2" ry="10" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="1.2" />
      <path d="M2.5 12h19" stroke="#fff" strokeOpacity=".5" strokeWidth="1" />
      <circle cx="16.4" cy="7.6" r="2.6" fill="#FFB800" stroke="#fff" strokeWidth="1" />
    </svg>
  );
}

const MORE: { href: string; label: string; note: string; Icon: typeof Heart }[] = [
  { href: "/trips", label: "Trips", note: "Plan it on the globe", Icon: Plane },
  { href: "/destinations", label: "Destinations", note: "Cities to explore", Icon: MapPinned },
  { href: "/match", label: "Match", note: "Swipe your next plan", Icon: Heart },
  { href: "/mixtape", label: "Mixtape", note: "A weekend, planned", Icon: Disc3 },
  { href: "/community", label: "Community", note: "Reviews and tips", Icon: MessagesSquare },
  { href: "/clubs", label: "Clubs", note: "Go together", Icon: Users },
  { href: "/studio", label: "Studio", note: "List your event", Icon: Sparkles },
];

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
  const saved = user.saved.length;

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
        <Link href="/events" className="tab" aria-current={on("/events") ? "page" : undefined}>
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
        <Link href="/my-world" className="tab" aria-current={on("/my-world") ? "page" : undefined} aria-label={saved ? `Saved: ${saved} ${saved === 1 ? "event" : "events"}` : "Saved"}>
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
        <section className="tab-sheet lg:hidden panel-in" role="dialog" aria-modal="true" aria-label="More of OMNIEVENT">
          <ul className="grid grid-cols-2 gap-2">
            {MORE.map(({ href, label, note, Icon }) => (
              <li key={href}>
                <Link href={href} className="tab-tile press" aria-current={on(href) ? "page" : undefined} onClick={() => setSheet(null)}>
                  <Icon size={20} aria-hidden className="text-cyan shrink-0" />
                  <span className="min-w-0">
                    <span className="block font-semibold leading-tight">{label}</span>
                    <span className="block t-micro text-text-3 truncate">{note}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-3 pt-3 border-t border-line flex items-center justify-between">
            <span className="t-small text-text-2">Light or dark</span>
            <ThemeToggle className="border border-line-strong" />
          </div>
        </section>
      )}
      {sheet === "search" && (
        <section className="tab-sheet tab-sheet--top lg:hidden panel-in" role="dialog" aria-modal="true" aria-label="Search">
          <SearchBox autoFocus placeholder="Events, artists, venues, cities…" />
        </section>
      )}
    </>
  );
}
