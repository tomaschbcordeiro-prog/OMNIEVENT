"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, Clapperboard, Compass, Dices, Globe2, Heart, History, Loader2, MapPin, Mic2, Moon, Plane, Plus, Search, Sparkles, Sun, MonitorSmartphone, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { setTheme } from "./theme-toggle";
import { Marked } from "./marked";
import { useUser } from "@/lib/user/store";

type Item = { id: string; label: string; hint?: string; href: string; icon: LucideIcon; group: string; words?: string; run?: () => void };

/** Places and things to do, always offered (filtered as you type). */
const STATIC: Item[] = [
  { id: "go-home", label: "Discover the globe", href: "/", icon: Globe2, group: "Go to", words: "home map planet" },
  { id: "go-events", label: "All events", href: "/events", icon: CalendarDays, group: "Go to", words: "list search" },
  { id: "go-dest", label: "Destinations", href: "/destinations", icon: MapPin, group: "Go to", words: "cities countries trip" },
  { id: "go-cats", label: "Categories", href: "/categories", icon: Clapperboard, group: "Go to", words: "music sport theatre" },
  { id: "go-match", label: "Event Match", href: "/match", icon: Heart, group: "Go to", words: "swipe" },
  { id: "go-mix", label: "Mixtape", hint: "Plan a night or a weekend", href: "/mixtape", icon: Sparkles, group: "Go to", words: "plan weekend tape" },
  { id: "go-community", label: "Community", href: "/community", icon: Users, group: "Go to", words: "people posts" },
  { id: "go-clubs", label: "Clubs", href: "/clubs", icon: Users, group: "Go to", words: "groups friends" },
  { id: "go-studio", label: "Studio", hint: "List your event", href: "/studio", icon: Mic2, group: "Go to", words: "organiser create" },
  { id: "go-world", label: "My World", hint: "Saved events, trips, alerts", href: "/my-world", icon: Compass, group: "Go to", words: "saved trips account" },
  { id: "do-spin", label: "Spin the globe", hint: "Land somewhere at random", href: "/?spin=1", icon: Dices, group: "Do", words: "random surprise" },
  { id: "do-flight", label: "Night Flight", hint: "Tonight, round the planet", href: "/?flight=1", icon: Plane, group: "Do", words: "tour tonight" },
  { id: "do-lights", label: "See the Earth at night", hint: "City lights from space", href: "/?style=lights", icon: Moon, group: "Do", words: "night lights dark black marble" },
  { id: "do-weekend", label: "Plan this weekend", href: "/mixtape?w=weekend", icon: Sparkles, group: "Do", words: "mixtape plan" },
  { id: "do-tonight", label: "What's on tonight", href: "/mixtape?w=tonight", icon: Moon, group: "Do", words: "tonight now" },
  { id: "do-list", label: "List your event", href: "/studio/new", icon: Plus, group: "Do", words: "create add organiser" },
  { id: "theme-dark", label: "Dark mode", hint: "Night colours everywhere", href: "#", icon: Moon, group: "Theme", words: "theme night black", run: () => setTheme("dark") },
  { id: "theme-light", label: "Light mode", href: "#", icon: Sun, group: "Theme", words: "theme day white bright", run: () => setTheme("light") },
  { id: "theme-system", label: "Match my device", hint: "Light or dark, as your device is set", href: "#", icon: MonitorSmartphone, group: "Theme", words: "theme system auto", run: () => setTheme("system") },
];

const strip = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Suggest = {
  destinations: { slug: string; name: string; kind: string; country?: string; events?: number }[];
  participants: { slug: string; name: string; kind: string }[];
  venues: { slug: string; name: string; city: string }[];
  events: { slug: string; title: string; city: string }[];
};

/**
 * The command menu: ⌘K (Ctrl+K) anywhere opens a box to jump to a page, start Spin, Night
 * Flight or a Mixtape, or find an event, artist, venue or place as you type.
 */
export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<Suggest | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const user = useUser();
  // The last few events opened on this device, offered first when nothing is typed yet.
  const [recent, setRecent] = useState<{ slug: string; title: string; city: string }[]>([]);
  const recentKey = user.recent.slice(0, 4).join(",");
  const back = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("omni:command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("omni:command", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      back.current = document.activeElement as HTMLElement | null;
      setQ("");
      setActive(0);
      setFound(null);
    } else back.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open || !recentKey) return;
    const ctrl = new AbortController();
    fetch(`/api/events/batch?ids=${encodeURIComponent(recentKey)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { items: { id: string; slug: string; title: string; city: string }[] } | null) => {
        if (!j) return;
        const byId = new Map(j.items.map((c) => [c.id, c]));
        setRecent(recentKey.split(",").map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c).slice(0, 3));
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [open, recentKey]);

  // Things that match what's typed, after a short pause.
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      setFound(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetch(`/api/search/suggest?q=${encodeURIComponent(t)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: Suggest | null) => setFound(j))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 180);
    return () => (window.clearTimeout(timer), ctrl.abort());
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const t = strip(q.trim());
    const statics = t ? STATIC.filter((i) => strip(`${i.label} ${i.hint ?? ""} ${i.words ?? ""}`).includes(t)) : STATIC;
    const dyn: Item[] = [];
    if (found && t.length >= 2) {
      for (const d of found.destinations.slice(0, 4)) dyn.push({ id: `d-${d.slug}`, label: d.name, hint: [d.kind === "city" ? d.country : d.kind, d.events ? `${d.events.toLocaleString("en-GB")} events` : ""].filter(Boolean).join(" · "), href: `/destinations/${d.slug}`, icon: MapPin, group: "Places" });
      for (const e of found.events.slice(0, 5)) dyn.push({ id: `e-${e.slug}`, label: e.title, hint: e.city, href: `/events/${e.slug}`, icon: CalendarDays, group: "Events" });
      for (const p of found.participants.slice(0, 3)) dyn.push({ id: `p-${p.slug}`, label: p.name, hint: p.kind, href: `/participants/${p.slug}`, icon: Mic2, group: "Artists & teams" });
      for (const v of found.venues.slice(0, 3)) dyn.push({ id: `v-${v.slug}`, label: v.name, hint: v.city, href: `/venues/${v.slug}`, icon: MapPin, group: "Venues" });
    }
    if (!t) for (const r of recent) dyn.push({ id: `r-${r.slug}`, label: r.title, hint: r.city, href: `/events/${r.slug}`, icon: History, group: "Recently viewed" });
    const all = [...dyn, ...statics];
    if (t) all.push({ id: "search", label: `Search everything for “${q.trim()}”`, href: `/events?q=${encodeURIComponent(q.trim())}&where=any`, icon: Search, group: "Search" });
    return all;
  }, [q, found, recent]);

  useEffect(() => setActive(0), [items.length]);

  const go = (i: Item | undefined) => {
    if (!i) return;
    setOpen(false);
    if (i.run) return i.run();
    // The globe reads its links on arrival: a fresh load starts Spin, Night Flight or night lights.
    if (i.href.startsWith("/?")) window.location.assign(i.href);
    else router.push(i.href);
  };

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="cmdk-root" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="cmdk panel-in" role="dialog" aria-modal="true" aria-label="Command menu">
        <div className="cmdk-input">
          {loading ? <Loader2 size={18} className="animate-spin text-text-3" aria-hidden /> : <Search size={18} className="text-text-3" aria-hidden />}
          <input
            ref={input}
            // Opened on purpose to type into: it takes the very first key.
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to a page, an event, an artist or a city…"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={items[active] ? `cmdk-${items[active].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Escape") return setOpen(false);
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(items.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(items[active]);
              }
            }}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <ul id="cmdk-list" role="listbox" aria-label="Results" className="cmdk-list scroll-thin">
          {items.map((i, n) => {
            const head = i.group !== lastGroup ? i.group : null;
            lastGroup = i.group;
            const Icon = i.icon;
            return (
              <li key={i.id} role="presentation">
                {head && <p className="cmdk-group">{head}</p>}
                <div id={`cmdk-${i.id}`} role="option" aria-selected={n === active} className="cmdk-item" onMouseMove={() => setActive(n)} onClick={() => go(i)}>
                  <span className="cmdk-icon">
                    <Icon size={16} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{i.group === "Search" ? i.label : <Marked text={i.label} terms={q.trim().length >= 2 ? q.trim().split(/\s+/) : undefined} />}</span>
                    {i.hint && <span className="block truncate t-micro text-text-3">{i.hint}</span>}
                  </span>
                  <ArrowRight size={15} className="cmdk-go" aria-hidden />
                </div>
              </li>
            );
          })}
          {!items.length && <li className="px-4 py-6 t-small text-text-3">Nothing matches. Try a city, an artist or an event.</li>}
        </ul>
        <p className="cmdk-foot t-micro">
          <span>
            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> to move · <kbd className="kbd">Enter</kbd> to open
          </span>
          <span className="max-sm:hidden">
            <kbd className="kbd">⌘</kbd> <kbd className="kbd">K</kbd> anywhere
          </span>
        </p>
      </div>
    </div>
  );
}
