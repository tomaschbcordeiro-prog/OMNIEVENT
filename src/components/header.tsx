"use client";

import { ThemeToggle } from "./theme-toggle";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { SearchBox } from "./search-box";
import { useUser } from "@/lib/user/store";
import { translate } from "@/lib/i18n";
import { NotificationBell } from "./community/bell";
import { AccountMenu } from "./community/account-menu";

const NAV = [
  { href: "/", key: "nav.discover" },
  { href: "/events", key: "nav.events" },
  // Categories stay one tap away from Events, the home chips and the footer.
  { href: "/destinations", key: "nav.destinations" },
  { href: "/match", key: "nav.match" },
  { href: "/mixtape", key: "nav.mixtape", fresh: true },
  { href: "/community", key: "nav.community" },
  { href: "/clubs", key: "nav.clubs", premium: true },
  { href: "/studio", key: "nav.studio", studio: true },
  { href: "/my-world", key: "nav.myworld" },
];

/** Wordmark: a meridian ring around a single point — one planet, one place. */
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 shrink-0 py-2.5 -my-2.5" aria-label="OMNIEVENT home">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="10" fill="#1463FF" />
        <ellipse cx="12" cy="12" rx="4.2" ry="10" fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="1.3" />
        <path d="M2.5 12h19" stroke="#fff" strokeOpacity=".45" strokeWidth="1.1" />
        <circle cx="16.4" cy="7.6" r="2.6" fill="#FFB800" stroke="#fff" strokeWidth="1" />
      </svg>
      <span className="font-bold tracking-[-0.03em] text-[16px]">OMNIEVENT</span>
    </Link>
  );
}

export function Header() {
  const path = usePathname();
  const user = useUser();
  const [search, setSearch] = useState(false);
  const t = (k: string) => translate(user.prefs.language, k);
  const isHome = path === "/";
  // A soft shadow once the page scrolls under the bar.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 6);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header data-scrolled={scrolled && !isHome ? "" : undefined} className={`site-header ${isHome ? "absolute inset-x-0 top-0" : "sticky top-0 bg-bg/85 backdrop-blur-md border-b border-line"} z-40`}>
      <a href="#main" className="sr-only-focusable absolute left-2 top-2 z-50 btn btn-primary">
        Skip to content
      </a>
      <div className="mx-auto flex h-[var(--header-h)] max-w-[1600px] items-center gap-4 px-4 sm:px-6">
        {/* On the globe page on phones, the search takes this place (the bottom bar has the globe). */}
        <div className={`flex items-center gap-2 ${isHome ? "compact:hidden rounded-full bg-panel/90 backdrop-blur-md shadow-[0_8px_24px_-12px_rgb(10_50_120_/_0.45)] pl-3 pr-3 lg:pr-1 py-1.5 lg:py-1" : ""}`}>
        <Logo />
        <nav aria-label="Main" className="hidden lg:flex items-center gap-0.5 ml-1 xl:ml-2">
          {NAV.map((n) => (
            n.studio ? (
              <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? "page" : undefined} className="nav-studio mx-0.5 px-2 xl:px-3 py-1 rounded-full text-sm whitespace-nowrap">
                <span className="nav-studio-dot" aria-hidden /> {t(n.key)}
              </Link>
            ) : n.premium ? (
              <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? "page" : undefined} className="nav-premium mx-0.5 px-2 xl:px-3 py-1 rounded-full text-sm whitespace-nowrap">
                <span className="nav-premium-star" aria-hidden>✦</span> <span className="nav-premium-text">{t(n.key)}</span>
              </Link>
            ) : (
              <Link
                key={n.href}
                href={n.href}
                aria-current={isActive(n.href) ? "page" : undefined}
                className={`px-1.5 xl:px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${isActive(n.href) ? (isHome ? "bg-text text-on-ink" : "text-text bg-text/[0.07]") : "text-text-2 hover:text-text hover:bg-text/[0.05]"}`}
              >
                {t(n.key)}
              </Link>
            )
          ))}
        </nav>
        </div>
        <div className="flex-1" />
        {/* Below 1440 px the full navigation and a search field don't both fit: search folds into a button. */}
        {!isHome && <SearchBox className="hidden md:block lg:hidden wide:block w-full max-w-md min-w-0" placeholder={t("search.short")} />}
        {!isHome && (
          <button className="btn btn-ghost btn-icon hidden lg:inline-flex wide:hidden" aria-label={search ? "Close search" : "Search"} aria-expanded={search} onClick={() => setSearch((v) => !v)}>
            {search ? <X size={19} aria-hidden /> : <Search size={19} aria-hidden />}
          </button>
        )}
        <ThemeToggle className={`max-lg:hidden ${isHome ? "rounded-full bg-panel/90 backdrop-blur-md shadow-[0_8px_24px_-12px_rgb(10_50_120_/_0.45)]" : ""}`} />
        <NotificationBell className={isHome ? "rounded-full bg-panel/90 backdrop-blur-md shadow-[0_8px_24px_-12px_rgb(10_50_120_/_0.45)]" : ""} />
        <AccountMenu floating={isHome} />
        {/* Phones and tablets: the menu is the bottom bar's "More" (MobileTabBar). */}
      </div>
      {search && !isHome && (
        <div className="hidden lg:block wide:hidden border-t border-line bg-panel shadow-lg px-6 py-3 panel-in">
          <SearchBox className="mx-auto max-w-2xl" autoFocus placeholder={t("search.placeholder")} />
        </div>
      )}
    </header>
  );
}
