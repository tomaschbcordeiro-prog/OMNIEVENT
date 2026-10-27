"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { SearchBox } from "./search-box";
import { useUser } from "@/lib/user/store";
import { translate } from "@/lib/i18n";
import { NotificationBell } from "./community/bell";
import { AccountMenu } from "./community/account-menu";

const NAV = [
  { href: "/", key: "nav.discover" },
  { href: "/events", key: "nav.events" },
  { href: "/categories", key: "nav.categories" },
  { href: "/destinations", key: "nav.destinations" },
  { href: "/match", key: "nav.match" },
  { href: "/community", key: "nav.community" },
  { href: "/my-world", key: "nav.myworld" },
];

/** Wordmark: a meridian ring around a single point — one planet, one place. */
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 shrink-0" aria-label="OMNIEVENT home">
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
  const [menu, setMenu] = useState(false);
  const t = (k: string) => translate(user.prefs.language, k);
  const isHome = path === "/";
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header className={`${isHome ? "absolute inset-x-0 top-0" : "sticky top-0 bg-bg/85 backdrop-blur-md border-b border-line"} z-40`}>
      <a href="#main" className="sr-only-focusable absolute left-2 top-2 z-50 btn btn-primary">
        Skip to content
      </a>
      <div className="mx-auto flex h-[var(--header-h)] max-w-[1600px] items-center gap-4 px-4 sm:px-6">
        <div className={`flex items-center gap-2 ${isHome ? "rounded-full bg-panel/90 backdrop-blur-md shadow-[0_8px_24px_-12px_rgb(10_50_120_/_0.45)] pl-3 pr-3 lg:pr-1 py-1.5 lg:py-1" : ""}`}>
        <Logo />
        <nav aria-label="Main" className="hidden lg:flex items-center gap-0.5 ml-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(n.href) ? "page" : undefined}
              className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${isActive(n.href) ? (isHome ? "bg-text text-white" : "text-text bg-text/[0.07]") : "text-text-2 hover:text-text hover:bg-text/[0.05]"}`}
            >
              {t(n.key)}
            </Link>
          ))}
        </nav>
        </div>
        <div className="flex-1" />
        {!isHome && <SearchBox className="hidden md:block w-full max-w-md" placeholder={t("search.placeholder")} />}
        <NotificationBell className={isHome ? "rounded-full bg-panel/90 backdrop-blur-md shadow-[0_8px_24px_-12px_rgb(10_50_120_/_0.45)]" : ""} />
        <AccountMenu floating={isHome} />
        <button className={`btn btn-ghost btn-icon lg:hidden ${isHome ? "rounded-full bg-panel/90 backdrop-blur-md shadow-[0_8px_24px_-12px_rgb(10_50_120_/_0.45)]" : ""}`} aria-label={menu ? "Close menu" : "Open menu"} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          {menu ? <X size={19} aria-hidden /> : <Menu size={19} aria-hidden />}
        </button>
      </div>
      {menu && (
        <div className="lg:hidden border-t border-line bg-panel shadow-lg px-4 pb-4 pt-3 panel-in">
          {!isHome && <SearchBox className="mb-3" placeholder={t("search.placeholder")} />}
          <nav aria-label="Main mobile" className="grid gap-1">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setMenu(false)} aria-current={isActive(n.href) ? "page" : undefined} className={`px-3 py-2.5 rounded-[var(--radius-s)] ${isActive(n.href) ? "bg-text/[0.07]" : "text-text-2"}`}>
                {t(n.key)}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
