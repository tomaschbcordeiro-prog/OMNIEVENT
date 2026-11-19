"use client";

import { ThemeToggle } from "./theme-toggle";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { SearchBox } from "./search-box";
import { useUser } from "@/lib/user/store";
import { translate } from "@/lib/i18n";
import { NotificationBell } from "./community/bell";
import { AccountMenu } from "./community/account-menu";
import { MundiviMark, Wordmark } from "./brand";
import { EXTRA, HELP } from "./nav-items";
import { BackButton } from "./back-button";

// Five places at the top (the same as the phone's tabs, give or take), the rest under "More",
// each with a line saying what it does: fewer choices to read, nothing hidden for good.
const NAV = [
  { href: "/", key: "nav.discover" },
  { href: "/events", key: "nav.events" },
  { href: "/trips", key: "nav.trips" },
  { href: "/community", key: "nav.community" },
  { href: "/my-world", key: "nav.myworld" },
];

/** Mundivi's logo: the mark (a planet whose meridians draw an "M", one event lit up) and the name. */
export function Logo() {
  return (
    <Link href="/" className="logo flex items-center gap-2 shrink-0 py-2.5 -my-2.5" aria-label="Mundivi home">
      <MundiviMark size={26} className="logo-mark" />
      <Wordmark className="text-[19px]" />
    </Link>
  );
}

export function Header() {
  const path = usePathname();
  const user = useUser();
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
    <header data-scrolled={scrolled && !isHome ? "" : undefined} data-home={isHome ? "" : undefined} className={`site-header ${isHome ? "absolute inset-x-0 top-0" : "sticky top-0 bg-bg/85 backdrop-blur-md border-b border-line"} z-40`}>
      <a href="#main" className="sr-only-focusable absolute left-2 top-2 z-50 btn btn-primary">
        Skip to content
      </a>
      <div className="mx-auto flex h-[var(--header-h)] max-w-[1600px] items-center gap-4 px-4 sm:px-6">
        {/* On the globe page on phones, the search takes this place (the bottom bar has the globe). */}
        <div className={`flex items-center gap-2 ${isHome ? "compact:hidden rounded-full bg-panel/90 backdrop-blur-md shadow-[0_8px_24px_-12px_rgb(10_50_120_/_0.45)] pl-3 pr-3 lg:pr-1 py-1.5 lg:py-1" : ""}`}>
        <BackButton />
        <Logo />
        <nav aria-label="Main" data-glide className="site-nav hidden lg:flex items-center gap-0.5 ml-1 xl:ml-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(n.href) ? "page" : undefined}
              className={`px-2.5 xl:px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${isActive(n.href) ? (isHome ? "bg-text text-on-ink" : "text-text bg-text/[0.07]") : "text-text-2 hover:text-text"}`}
            >
              {t(n.key)}
            </Link>
          ))}
          <MoreMenu label={t("nav.more")} path={path} onHome={isHome} />
        </nav>
        </div>
        <div className="flex-1" />
        {!isHome && <SearchBox className="hidden md:block w-full max-w-md min-w-0" placeholder={t("search.short")} />}
        <ThemeToggle className={`max-lg:hidden ${isHome ? "rounded-full bg-panel/90 backdrop-blur-md shadow-[0_8px_24px_-12px_rgb(10_50_120_/_0.45)]" : ""}`} />
        <NotificationBell className={isHome ? "rounded-full bg-panel/90 backdrop-blur-md shadow-[0_8px_24px_-12px_rgb(10_50_120_/_0.45)]" : ""} />
        <AccountMenu floating={isHome} />
        {/* Phones and tablets: the menu is the bottom bar's "More" (MobileTabBar). */}
      </div>
    </header>
  );
}

/** "More": the rest of Mundivi, each with what it does, plus help. */
function MoreMenu({ label, path, onHome }: { label: string; path: string; onHome: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Closes on a click elsewhere, on Escape (focus back on the button) and when the page changes.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useEffect(() => setOpen(false), [path]);
  const items = [...EXTRA, HELP];
  const here = (href: string) => path === href || (path.startsWith(href + "/") && !items.some((m) => m.href !== href && m.href.startsWith(href) && path.startsWith(m.href)));
  const inside = items.some((m) => here(m.href));
  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="more-menu"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 px-2.5 xl:px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${inside ? (onHome ? "bg-text text-on-ink" : "text-text bg-text/[0.07]") : "text-text-2 hover:text-text"} ${open ? "bg-text/[0.07] text-text" : ""}`}
      >
        {label}
        <ChevronDown size={14} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id="more-menu" className="more-menu surface-float panel-in">
          <ul className="grid grid-cols-2 gap-1" data-glide>
            {EXTRA.map(({ href, label: name, note, Icon, fresh }) => (
              <li key={href}>
                <Link href={href} className="more-item" aria-current={here(href) ? "page" : undefined}>
                  <span className="more-icon" aria-hidden><Icon size={18} /></span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-text leading-tight">{name}{fresh && <span className="tab-new">New</span>}</span>
                    <span className="block t-micro text-text-2">{note}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href={HELP.href} className="more-item more-help" aria-current={here(HELP.href) ? "page" : undefined}>
            <span className="more-icon" aria-hidden><HELP.Icon size={18} /></span>
            <span className="min-w-0">
              <span className="block font-semibold text-text leading-tight">{HELP.label}</span>
              <span className="block t-micro text-text-2">{HELP.note}: questions and answers, shortcuts</span>
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
