"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X, CircleUserRound } from "lucide-react";
import { SearchBox } from "./search-box";
import { useUser } from "@/lib/user/store";
import { translate } from "@/lib/i18n";

const NAV = [
  { href: "/", key: "nav.discover" },
  { href: "/events", key: "nav.events" },
  { href: "/categories", key: "nav.categories" },
  { href: "/destinations", key: "nav.destinations" },
  { href: "/my-world", key: "nav.myworld" },
];

/** Wordmark: a meridian ring around a single point — one planet, one place. */
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 shrink-0" aria-label="OMNIEVENT home">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="10" fill="none" stroke="#42DFFF" strokeWidth="1.6" />
        <ellipse cx="12" cy="12" rx="4.2" ry="10" fill="none" stroke="#42DFFF" strokeOpacity=".55" strokeWidth="1.2" />
        <circle cx="15.6" cy="8.4" r="2.1" fill="#9275FF" />
      </svg>
      <span className="font-semibold tracking-[-0.02em] text-[15px]">OMNIEVENT</span>
    </Link>
  );
}

export function Header() {
  const path = usePathname();
  const user = useUser();
  const [menu, setMenu] = useState(false);
  const t = (k: string) => translate(user.prefs.language, k);
  const isHome = path === "/";
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header className={`${isHome ? "absolute inset-x-0 top-0 bg-gradient-to-b from-bg via-bg/70 to-transparent" : "sticky top-0 bg-bg/90 backdrop-blur border-b border-line"} z-40`}>
      <a href="#main" className="sr-only-focusable absolute left-2 top-2 z-50 btn btn-primary">
        Skip to content
      </a>
      <div className="mx-auto flex h-[var(--header-h)] max-w-[1600px] items-center gap-4 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="hidden lg:flex items-center gap-0.5 ml-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(n.href) ? "page" : undefined}
              className={`px-3 py-1.5 rounded-[var(--radius-s)] text-sm transition-colors ${isActive(n.href) ? "text-text bg-white/[0.06]" : "text-text-2 hover:text-text"}`}
            >
              {t(n.key)}
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        {!isHome && <SearchBox className="hidden md:block w-full max-w-md" placeholder={t("search.placeholder")} />}
        <Link href="/my-world?tab=account" className="btn btn-ghost btn-icon hidden sm:inline-flex" aria-label="Account and preferences">
          <CircleUserRound size={19} aria-hidden />
        </Link>
        <button className="btn btn-ghost btn-icon lg:hidden" aria-label={menu ? "Close menu" : "Open menu"} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          {menu ? <X size={19} aria-hidden /> : <Menu size={19} aria-hidden />}
        </button>
      </div>
      {menu && (
        <div className="lg:hidden border-t border-line bg-bg px-4 pb-4 pt-3 panel-in">
          {!isHome && <SearchBox className="mb-3" placeholder={t("search.placeholder")} />}
          <nav aria-label="Main mobile" className="grid gap-1">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setMenu(false)} aria-current={isActive(n.href) ? "page" : undefined} className={`px-3 py-2.5 rounded-[var(--radius-s)] ${isActive(n.href) ? "bg-white/[0.06]" : "text-text-2"}`}>
                {t(n.key)}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
