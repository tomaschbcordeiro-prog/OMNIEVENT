"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Bookmark, CalendarDays, Route, Heart, Bell, Settings, LayoutDashboard, TriangleAlert, Trash2, Download,
  ChevronLeft, ChevronRight, Search as SearchIcon, Map as MapIcon, List as ListIcon, Users, CalendarPlus,
} from "lucide-react";
import type { EventCard } from "@/lib/types";
import { useUser, userActions } from "@/lib/user/store";
import { GROUPS } from "@/lib/categories";
import { CITIES } from "@/lib/destinations";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n";
import { formatEventTime, localDateKey, tzAbbrev } from "@/lib/format";
import { EventRow } from "../event-card";
import { HowWasIt } from "@/components/how-was-it";
import { TripsList } from "@/components/trips/trips-home";
import { EmptyState, ErrorState, Notice, ShapeGlyph } from "../ui";
import { MyCommunity } from "../community/my-community";
import { AccountPanel } from "../community/account-panel";
import { MyEvents } from "../create/my-events";

type Tab = "overview" | "saved" | "searches" | "calendar" | "trips" | "events" | "following" | "community" | "alerts" | "account";
const TABS: { id: Tab; label: string; icon: typeof Bookmark }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "saved", label: "Saved", icon: Bookmark },
  { id: "searches", label: "Saved searches", icon: SearchIcon },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "trips", label: "Trips", icon: Route },
  { id: "events", label: "My events", icon: CalendarPlus },
  { id: "following", label: "Following", icon: Heart },
  { id: "community", label: "Community", icon: Users },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "account", label: "Account", icon: Settings },
];

/** Load cards for a set of ids (saved, recent, trips). Missing ids = events no longer listed. */
function useCards(ids: string[]) {
  const key = [...new Set(ids)].sort().join(",");
  const [state, setState] = useState<{ cards: Map<string, EventCard>; missing: string[]; loading: boolean; error?: string }>({ cards: new Map(), missing: [], loading: false });
  useEffect(() => {
    if (!key) {
      setState({ cards: new Map(), missing: [], loading: false });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    fetch(`/api/events/batch?ids=${encodeURIComponent(key)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { items: EventCard[]; missing: string[] }) => setState({ cards: new Map(j.items.map((c) => [c.id, c])), missing: j.missing, loading: false }))
      .catch((e) => e.name !== "AbortError" && setState({ cards: new Map(), missing: [], loading: false, error: String(e.message) }));
    return () => ctrl.abort();
  }, [key]);
  return state;
}

const endOf = (c: EventCard) => new Date(c.start).getTime() + 2.5 * 3600000; // cards have no end; assume a typical 2.5 h slot

/** Pairs of dated events whose time windows overlap. */
function conflicts(cards: EventCard[]): Set<string> {
  const dated = cards.filter((c) => c.eventType !== "daily_attraction").sort((a, b) => a.start.localeCompare(b.start));
  const out = new Set<string>();
  for (let i = 0; i < dated.length; i++)
    for (let j = i + 1; j < dated.length && new Date(dated[j].start).getTime() < endOf(dated[i]); j++) {
      out.add(dated[i].id);
      out.add(dated[j].id);
    }
  return out;
}

export function MyWorldClient() {
  const sp = useSearchParams();
  const router = useRouter();
  const user = useUser();
  const tab = (TABS.find((t) => t.id === sp.get("tab"))?.id ?? "overview") as Tab;
  const setTab = (t: Tab) => router.replace(`/my-world?tab=${t}`, { scroll: false });
  const allIds = useMemo(() => [...user.saved.map((s) => s.id), ...user.recent, ...user.trips.flatMap((t) => t.eventIds)], [user.saved, user.recent, user.trips]);
  const { cards, missing, loading, error } = useCards(allIds);

  return (
    <div className="grid gap-8 grid-cols-1 lg:grid-cols-[220px_1fr]">
      <nav aria-label="My World sections" className="min-w-0 lg:sticky lg:top-[calc(var(--header-h)+1.5rem)] self-start">
        <ul className="flex lg:flex-col gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`btn btn-sm w-full justify-start ${tab === t.id ? "bg-text/[0.07] text-text" : "btn-ghost"}`}
              >
                <t.icon size={15} aria-hidden /> {t.label}
                {t.id === "saved" && user.saved.length > 0 && <span className="ml-auto text-text-3 tnum">{user.saved.length}</span>}
                {t.id === "trips" && user.trips.length > 0 && <span className="ml-auto text-text-3 tnum">{user.trips.length}</span>}
                {t.id === "searches" && user.searches.length > 0 && <span className="ml-auto text-text-3 tnum">{user.searches.length}</span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0">
        {error && <div className="mb-4"><ErrorState title="Couldn't load your saved events" body={error} /></div>}
        {tab === "overview" && <Overview cards={cards} loading={loading} onTab={setTab} />}
        {tab === "saved" && <Saved cards={cards} missing={missing} loading={loading} />}
        {tab === "searches" && <SavedSearches />}
        {tab === "calendar" && <Calendar cards={cards} />}
        {tab === "trips" && <Trips />}
        {tab === "events" && <MyEvents />}
        {tab === "following" && <Following />}
        {tab === "community" && (
          <>
            <h1 className="t-h1 mb-6">My community</h1>
            <MyCommunity />
          </>
        )}
        {tab === "alerts" && <Alerts />}
        {tab === "account" && <Account />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Overview

function Overview({ cards, loading, onTab }: { cards: Map<string, EventCard>; loading: boolean; onTab: (t: Tab) => void }) {
  const user = useUser();
  const now = Date.now();
  const upcoming = user.saved.map((s) => cards.get(s.id)).filter((c): c is EventCard => !!c && new Date(c.start).getTime() > now - 86400000).sort((a, b) => a.start.localeCompare(b.start));
  const recent = user.recent.map((id) => cards.get(id)).filter((c): c is EventCard => !!c).slice(0, 5);
  const recParams = new URLSearchParams({ size: "6", status: "on_sale" });
  if (user.prefs.interests.length) recParams.set("cat", user.prefs.interests.join(","));
  if (user.prefs.homeCityId) recParams.set("city", user.prefs.homeCityId);
  const [recs, setRecs] = useState<EventCard[] | null>(null);
  useEffect(() => {
    if (!user.prefs.interests.length && !user.prefs.homeCityId) return setRecs(null);
    const ctrl = new AbortController();
    fetch(`/api/events?${recParams}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => setRecs(j.items))
      .catch(() => {});
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recParams.toString()]);

  return (
    <div className="grid gap-10">
      <header>
        <h1 className="t-h1">My World</h1>
        <p className="t-lede text-text-2 mt-2">Your saved events, plans, trips and alerts in one place, with picks based on what you like.</p>
      </header>
      {!user.onboarded && <Onboarding />}
      <HowWasIt cards={cards} />
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="t-h2">Coming up for you</h2>
          {upcoming.length > 0 && <button className="t-small text-text-2 hover:text-cyan" onClick={() => onTab("calendar")}>Open calendar</button>}
        </div>
        {loading && !upcoming.length ? (
          <div className="grid gap-2 mt-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14" />)}</div>
        ) : upcoming.length ? (
          <ul className="divide-y divide-line mt-2">{upcoming.slice(0, 5).map((c) => <EventRow key={c.id} c={c} />)}</ul>
        ) : (
          <div className="mt-3"><EmptyState title="Nothing saved yet" body="Save events from the globe or any event page and they'll appear here in date order." action={<Link href="/" className="btn btn-primary btn-sm">Explore the globe</Link>} /></div>
        )}
      </section>

      <section>
        <h2 className="t-h2">Recommended</h2>
        {recs === null ? (
          <p className="t-small text-text-2 mt-2">Choose your interests and home city in <button className="underline hover:text-text" onClick={() => onTab("account")}>preferences</button> to see matching events. Recommendations only use what you choose here.</p>
        ) : recs.length ? (
          <>
            <p className="t-micro text-text-3 mt-1">On-sale events matching your interests{user.prefs.homeCityId ? " near your home city" : ""}.</p>
            <ul className="divide-y divide-line mt-2">{recs.map((c) => <EventRow key={c.id} c={c} />)}</ul>
          </>
        ) : (
          <p className="t-small text-text-2 mt-2">Nothing on sale matches your interests right now.</p>
        )}
      </section>

      {recent.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="t-h2">Recently viewed</h2>
            <button className="see-all t-small text-text-2 hover:text-cyan" onClick={() => userActions.clearRecent()}>Clear</button>
          </div>
          <ul className="divide-y divide-line mt-2">{recent.map((c) => <EventRow key={c.id} c={c} />)}</ul>
        </section>
      )}
    </div>
  );
}

function Onboarding() {
  const user = useUser();
  const [step, setStep] = useState(0);
  const [interests, setInterests] = useState<string[]>(user.prefs.interests);
  const [home, setHome] = useState(user.prefs.homeCityId ?? "");
  const [currency, setCurrency] = useState(user.prefs.currency);
  const steps = ["What do you like?", "Where are you based?", "How should prices show?"];
  const finish = () => {
    userActions.setPrefs({ interests, homeCityId: home || undefined, currency });
    userActions.setOnboarded();
  };
  return (
    <section aria-labelledby="onb" className="rounded-[var(--radius-l)] border border-cyan/30 bg-cyan/[0.04] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="t-micro text-text-3 tnum">Step {step + 1} of {steps.length}</p>
          <h2 id="onb" className="t-h2 mt-0.5">{steps[step]}</h2>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => userActions.setOnboarded()}>Skip for now</button>
      </div>
      <div className="mt-4">
        {step === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {GROUPS.filter((g) => g.slug !== "other").map((g) => (
              <button key={g.slug} className="chip" aria-pressed={interests.includes(g.slug)} onClick={() => setInterests((i) => (i.includes(g.slug) ? i.filter((x) => x !== g.slug) : [...i, g.slug]))}>
                <ShapeGlyph group={g.slug} size={9} /> {g.name}
              </button>
            ))}
          </div>
        )}
        {step === 1 && (
          <div className="max-w-sm">
            <label className="label" htmlFor="onb-home">Home city (optional)</label>
            <select id="onb-home" className="field" value={home} onChange={(e) => setHome(e.target.value)}>
              <option value="">Prefer not to say</option>
              {[...CITIES].sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}, {c.country}</option>)}
            </select>
            <p className="t-micro text-text-3 mt-1.5">Used only to suggest nearby events. We never ask for your precise location here.</p>
          </div>
        )}
        {step === 2 && (
          <div className="max-w-sm">
            <label className="label" htmlFor="onb-cur">Show price estimates in</label>
            <select id="onb-cur" className="field" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <p className="t-micro text-text-3 mt-1.5">Sellers&apos; own prices always come first. Converted amounts are labelled as estimates.</p>
          </div>
        )}
      </div>
      <div className="mt-5 flex gap-2">
        {step > 0 && <button className="btn btn-secondary btn-sm" onClick={() => setStep((s) => s - 1)}>Back</button>}
        {step < steps.length - 1 ? <button className="btn btn-primary btn-sm" onClick={() => setStep((s) => s + 1)}>Continue</button> : <button className="btn btn-primary btn-sm" onClick={finish}>Save preferences</button>}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Saved

function Saved({ cards, missing, loading }: { cards: Map<string, EventCard>; missing: string[]; loading: boolean }) {
  const user = useUser();
  const [show, setShow] = useState<"upcoming" | "all">("upcoming");
  const list = user.saved.map((s) => cards.get(s.id)).filter((c): c is EventCard => !!c);
  const now = Date.now();
  const shown = (show === "upcoming" ? list.filter((c) => c.status !== "completed" && (c.eventType === "daily_attraction" || new Date(c.start).getTime() > now - 86400000)) : list).sort((a, b) => a.start.localeCompare(b.start));
  const savedMissing = user.saved.filter((s) => missing.includes(s.id));
  const upcomingIds = list.filter((c) => c.status !== "completed" && c.eventType !== "daily_attraction" && new Date(c.start).getTime() > now).slice(0, 100).map((c) => c.id);
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="t-h1">Saved events</h1>
        <div className="flex flex-wrap gap-1.5">
          <button className="chip" aria-pressed={show === "upcoming"} onClick={() => setShow("upcoming")}>Upcoming</button>
          <button className="chip" aria-pressed={show === "all"} onClick={() => setShow("all")}>All</button>
          {/* Every upcoming saved event in one file, for Google, Apple or Outlook calendars. */}
          {upcomingIds.length > 0 && (
            <a className="chip" href={`/api/events/calendar?ids=${encodeURIComponent(upcomingIds.join(","))}`} download>
              <CalendarPlus size={13} aria-hidden /> Add {upcomingIds.length === 1 ? "it" : `all ${upcomingIds.length}`} to calendar
            </a>
          )}
        </div>
      </div>
      {loading && !list.length ? (
        <div className="grid gap-2 mt-4">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14" />)}</div>
      ) : shown.length ? (
        <ul className="divide-y divide-line mt-3">{shown.map((c) => <EventRow key={c.id} c={c} />)}</ul>
      ) : (
        <div className="mt-4"><EmptyState title="No saved events" body="Use the bookmark on any event to keep it here." action={<Link href="/events" className="btn btn-primary btn-sm">Browse events</Link>} /></div>
      )}
      {savedMissing.length > 0 && (
        <div className="mt-6">
          <Notice>
            {savedMissing.length} saved {savedMissing.length === 1 ? "event is" : "events are"} no longer listed by our sources (for example, demo data that has been regenerated, or a provider removed the listing).{" "}
            <button className="underline hover:text-text" onClick={() => savedMissing.forEach((s) => userActions.toggleSave(s.id))}>Remove them</button>
          </Notice>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Saved searches

function SavedSearches() {
  const user = useUser();
  return (
    <section>
      <h1 className="t-h1">Saved searches</h1>
      <p className="t-small text-text-2 mt-1 measure">
        A saved search keeps its place, radius, dates, local times and categories. Opening it runs it again, so results are always current. Saved in this browser.
      </p>
      {user.searches.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No saved searches yet"
            body="On the map, choose Explore an area, set a radius and times, then press Save search."
            action={<Link href="/" className="btn btn-primary btn-sm">Explore the map</Link>}
          />
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-line">
          {user.searches.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold truncate">{x.name}</p>
                <p className="t-small text-text-2 truncate">{x.summary}</p>
                <p className="t-micro text-text-3">Saved {new Date(x.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
              </div>
              <div className="flex gap-1.5">
                <Link href={`/?${x.params}`} className="btn btn-primary btn-sm"><MapIcon size={14} aria-hidden /> Map</Link>
                <Link href={`/events?${x.params}`} className="btn btn-secondary btn-sm"><ListIcon size={14} aria-hidden /> List</Link>
                <button className="btn btn-ghost btn-icon btn-sm" aria-label={`Delete saved search ${x.name}`} onClick={() => userActions.deleteSearch(x.id)}>
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Calendar

function Calendar({ cards }: { cards: Map<string, EventCard> }) {
  const user = useUser();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const list = user.saved.map((s) => cards.get(s.id)).filter((c): c is EventCard => !!c && c.eventType !== "daily_attraction");
  const clash = conflicts(list);
  const byDay = new Map<string, EventCard[]>();
  for (const c of list) {
    const k = localDateKey(c.start, c.timeZone);
    byDay.set(k, [...(byDay.get(k) ?? []), c]);
  }
  const first = new Date(month);
  const offset = (first.getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, i) => {
    const day = i - offset + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });
  const key = (d: number) => `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const todayKey = localDateKey(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  const inMonth = list.filter((c) => localDateKey(c.start, c.timeZone).startsWith(key(1).slice(0, 7))).sort((a, b) => a.start.localeCompare(b.start));

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h1 className="t-h1">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h1>
        <div className="flex gap-1">
          <button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous month" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}><ChevronLeft size={15} aria-hidden /></button>
          <button className="btn btn-secondary btn-sm" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button>
          <button className="btn btn-secondary btn-icon btn-sm" aria-label="Next month" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}><ChevronRight size={15} aria-hidden /></button>
        </div>
      </div>
      <p className="t-small text-text-3 mt-1">Saved events on their local date at the venue. Ticket purchases aren&apos;t shown: no seller is connected to confirm them.</p>
      {clash.size > 0 && (
        <p className="mt-3 flex items-center gap-2 t-small text-warn"><TriangleAlert size={15} aria-hidden /> {clash.size} saved events overlap in time.</p>
      )}
      <div className="mt-4 grid grid-cols-7 gap-px rounded-[var(--radius-m)] overflow-hidden border border-line bg-line" role="grid" aria-label="Month calendar">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} role="columnheader" className="bg-panel-2 px-2 py-1.5 t-micro text-text-3">{d}</div>
        ))}
        {cells.map((d, i) => {
          const items = d ? byDay.get(key(d)) ?? [] : [];
          return (
            <div key={i} role="gridcell" className={`min-h-20 sm:min-h-24 bg-bg-2 p-1.5 ${d ? "" : "opacity-40"}`}>
              {d && <span className={`t-micro tnum ${key(d) === todayKey ? "inline-grid place-items-center h-5 w-5 rounded-full bg-cyan text-[#021018] font-semibold" : "text-text-3"}`}>{d}</span>}
              <ul className="mt-1 grid gap-0.5">
                {items.slice(0, 3).map((c) => (
                  <li key={c.id}>
                    <Link href={`/events/${c.slug}`} className={`block truncate rounded px-1 py-0.5 text-[11px] leading-tight ${clash.has(c.id) ? "bg-warn/15 text-warn" : "bg-text/5 hover:bg-text/[0.08]"}`} title={`${c.title}, ${formatEventTime(c.start, c.timeZone)} ${tzAbbrev(c.start, c.timeZone)}`}>
                      <span className="tnum text-text-3">{formatEventTime(c.start, c.timeZone)}</span> {c.title}
                    </Link>
                  </li>
                ))}
                {items.length > 3 && <li className="t-micro text-text-3 px-1">+{items.length - 3} more</li>}
              </ul>
            </div>
          );
        })}
      </div>
      {inMonth.length > 0 && (
        <ul className="divide-y divide-line mt-6">{inMonth.map((c) => <EventRow key={c.id} c={c} />)}</ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Trips

/** Trips: the boarding passes, each opening its trip on the globe. */
function Trips() {
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-h1">Trips</h1>
          <p className="t-small text-text-2 mt-1 measure">Cities, countries and dates, with the events you want on the way, on the globe.</p>
        </div>
        <Link href="/trips/new" className="btn btn-primary btn-sm press">Plan a trip</Link>
      </div>
      <TripsList />
    </section>
  );
}

function Following() {
  const user = useUser();
  const kinds: { k: "participant" | "venue" | "destination" | "competition" | "category"; title: string; href: (id: string) => string }[] = [
    { k: "participant", title: "Artists, teams and performers", href: (id) => `/participants/${id}` },
    { k: "venue", title: "Venues", href: (id) => `/venues/${id}` },
    { k: "destination", title: "Destinations", href: (id) => `/destinations/${id}` },
    { k: "competition", title: "Competitions", href: (id) => `/events?competition=${encodeURIComponent(id)}` },
    { k: "category", title: "Categories", href: (id) => `/categories/${id}` },
  ];
  return (
    <section>
      <h1 className="t-h1">Following</h1>
      <p className="t-small text-text-2 mt-1">Use Follow on artist, team, venue and destination pages.</p>
      {user.follows.length === 0 ? (
        <div className="mt-5"><EmptyState title="You aren't following anything yet" action={<Link href="/destinations" className="btn btn-secondary btn-sm">Find a destination</Link>} /></div>
      ) : (
        <div className="mt-6 grid gap-8 md:grid-cols-2">
          {kinds.map(({ k, title, href }) => {
            const items = user.follows.filter((f) => f.kind === k);
            if (!items.length) return null;
            return (
              <div key={k}>
                <h2 className="t-h3">{title}</h2>
                <ul className="mt-2 divide-y divide-line">
                  {items.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={href(f.id)} className="hover:text-cyan truncate">{f.name}</Link>
                      <button className="btn btn-ghost btn-sm" onClick={() => userActions.toggleFollow(f.kind, f.id, f.name)}>Unfollow</button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const ALERTS: { k: string; label: string; needs: string }[] = [
  { k: "followedPerformers", label: "New events from artists and teams I follow", needs: "provider sync + notification service" },
  { k: "newFixtures", label: "New fixtures for followed teams and competitions", needs: "provider sync + notification service" },
  { k: "cityAnnouncements", label: "Events announced in my followed destinations", needs: "provider sync + notification service" },
  { k: "salesOpening", label: "When tickets go on sale", needs: "seller on-sale dates + notification service" },
  { k: "priceChanges", label: "Price changes on saved events", needs: "an authorised price-monitoring source" },
  { k: "cancellations", label: "Cancellations of saved events", needs: "provider sync + notification service" },
  { k: "rescheduled", label: "Date changes of saved events", needs: "provider sync + notification service" },
  { k: "upcomingSaved", label: "Reminders before saved events", needs: "notification service" },
  { k: "recommendations", label: "New experiences matching my interests", needs: "notification service" },
];

function Alerts() {
  const user = useUser();
  return (
    <section>
      <h1 className="t-h1">Alerts</h1>
      <div className="mt-3">
        <Notice>
          Your choices are saved, but <strong className="text-text">no alerts are being sent yet</strong>: OMNIEVENT doesn&apos;t have an email or push service connected. Nothing here will be marked as sent until a delivery service confirms it.
        </Notice>
      </div>
      <ul className="mt-5 divide-y divide-line">
        {ALERTS.map((a) => (
          <li key={a.k} className="flex items-start justify-between gap-4 py-3">
            <div>
              <label htmlFor={`al-${a.k}`} className="font-medium">{a.label}</label>
              <p className="t-micro text-text-3">Needs {a.needs}</p>
            </div>
            <input id={`al-${a.k}`} type="checkbox" role="switch" className="mt-1 h-5 w-9 accent-[var(--cyan)]" checked={!!user.prefs.notifications[a.k]} onChange={(e) => userActions.setPrefs({ notifications: { ...user.prefs.notifications, [a.k]: e.target.checked } })} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Account() {
  const user = useUser();
  const p = user.prefs;
  return (
    <section className="grid gap-10">
      <div>
        <h1 className="t-h1">Account</h1>
        <div className="mt-4">
          <AccountPanel />
        </div>
      </div>

      <div>
        <h2 className="t-h2">Preferences</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 max-w-2xl">
          <div>
            <label className="label" htmlFor="p-lang">Language</label>
            <select id="p-lang" className="field" value={p.language} onChange={(e) => userActions.setPrefs({ language: e.target.value as typeof p.language })}>
              {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
            </select>
            <p className="t-micro text-text-3 mt-1">Translates navigation and category names. Event details stay in the seller&apos;s language.</p>
          </div>
          <div>
            <label className="label" htmlFor="p-cur">Price estimates in</label>
            <select id="p-cur" className="field" value={p.currency} onChange={(e) => userActions.setPrefs({ currency: e.target.value })}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="p-home">Home city</label>
            <select id="p-home" className="field" value={p.homeCityId ?? ""} onChange={(e) => userActions.setPrefs({ homeCityId: e.target.value || undefined })}>
              <option value="">Not set</option>
              {[...CITIES].sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}, {c.country}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="p-budget">Typical budget per ticket ({p.currency})</label>
            <input id="p-budget" type="number" min={0} className="field tnum" value={p.budget ?? ""} onChange={(e) => userActions.setPrefs({ budget: e.target.value === "" ? undefined : +e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="p-travel">How far will you travel?</label>
            <select id="p-travel" className="field" value={p.travel ?? ""} onChange={(e) => userActions.setPrefs({ travel: (e.target.value || undefined) as typeof p.travel })}>
              <option value="">Not set</option>
              <option value="local">Stay local</option>
              <option value="regional">Within my region</option>
              <option value="anywhere">Anywhere</option>
            </select>
          </div>
        </div>
        <fieldset className="mt-5">
          <legend className="label">Interests</legend>
          <div className="flex flex-wrap gap-1.5">
            {GROUPS.filter((g) => g.slug !== "other").map((g) => (
              <button key={g.slug} className="chip" aria-pressed={p.interests.includes(g.slug)} onClick={() => userActions.setPrefs({ interests: p.interests.includes(g.slug) ? p.interests.filter((x) => x !== g.slug) : [...p.interests, g.slug] })}>
                <ShapeGlyph group={g.slug} size={9} /> {g.name}
              </button>
            ))}
          </div>
        </fieldset>
        {user.onboarded && <button className="btn btn-ghost btn-sm mt-3 -ml-2" onClick={() => userActions.setOnboarded(false)}>Run the welcome steps again</button>}
      </div>

      <div>
        <h2 className="t-h2">Privacy and your data</h2>
        <ul className="t-small text-text-2 mt-2 grid gap-1 list-disc pl-4 measure">
          <li>Saved items, trips and preferences stay in this browser&apos;s storage. They aren&apos;t sent to our servers.</li>
          <li>Your location is only requested when you press the locate button, and is used once to filter results.</li>
          <li>Searches you type go to our server to find results; they aren&apos;t linked to an identity.</li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              const blob = new Blob([userActions.exportData()], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "omnievent-my-data.json";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            <Download size={14} aria-hidden /> Export my data
          </button>
          <button className="btn btn-secondary btn-sm text-bad" onClick={() => confirm("Delete all saved events, trips, follows and preferences from this browser? This can't be undone.") && userActions.deleteAll()}>
            <Trash2 size={14} aria-hidden /> Delete all my data
          </button>
        </div>
      </div>
    </section>
  );
}
