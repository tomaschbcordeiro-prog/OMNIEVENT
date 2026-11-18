"use client";

import type { TripPlan } from "../trip-plans";
import { useSyncExternalStore } from "react";
import type { TripStop } from "../trip";
import type { CheckItem, Contact, Expense, Message, Traveller, TripContent } from "../trip-share";

/**
 * Personal data store — DEMO MODE implementation.
 *
 * Everything here lives only in this browser (localStorage). There is no server
 * account, so nothing is shared across devices and no one else can read it.
 * The `UserData` shape mirrors the Postgres tables in db/migrations (saved_items,
 * trips, trip_events, user_preferences) so a Supabase-backed implementation can
 * replace `persist()`/`load()` without touching components.
 */

export interface Trip {
  id: string;
  name: string;
  start?: string; // YYYY-MM-DD
  end?: string;
  eventIds: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  /** The route: each city and the nights there (trips made before routes have none). */
  stops?: TripStop[];
  /** An emoji for the trip's pass. */
  emoji?: string;
  /** Kinds of events to suggest (category groups); empty for anything. */
  interests?: string[];
  /** What each event in the trip looked like when it was added, to show it on the globe after it's gone. */
  snaps?: Record<string, TripEventSnap>;
  /** Your own plans on the trip: flights, stays, meetings, meals… */
  plans?: TripPlan[];
  /** Its id among the trips shared with everyone, once shared. */
  sharedId?: string;
  /** The trip's money: its currency, a budget, and every cost (with who paid and who shares it). */
  currency?: string;
  budget?: number;
  expenses?: Expense[];
  /** Packing, things to do before leaving, documents. */
  checklist?: CheckItem[];
  contacts?: Contact[];
  /** Who's travelling (to split costs and hand out tasks). */
  travellers?: Traveller[];
  /** The trip's chat, when planned together. */
  messages?: Message[];
  /** Planned together with others: the shared trip it is, and this device's key to it. */
  group?: GroupLink;
}

export type GroupRole = "owner" | "editor" | "viewer";
export interface GroupLink {
  id: string;
  key: string;
  me: string;
  role: GroupRole;
  /** The version last seen from the server, and the trip as it was then (to know what changed here). */
  v: number;
  base: TripContent;
  members: { id: string; name: string; role: GroupRole; seen?: string }[];
  code?: string;
  invite?: string;
  open: boolean;
  log: { at: string; by: string; text: string }[];
  syncedAt?: string;
  /** The site's storage isn't connected yet: shared trips may be cleared. */
  testMode?: boolean;
  /** This device only: when the trip was last opened here, and the chat last read. */
  lastOpened?: string;
  lastRead?: string;
}

/** A trip's event as kept with the trip: what a saved event keeps, plus where it is. */
export interface TripEventSnap extends SavedSnap {
  lat: number;
  lng: number;
  city: string;
  cityId?: string;
  countryCode?: string;
  groupSlug: string;
  /** Last day of a run (an exhibition, a festival), when it lasts more than a day. */
  until?: string;
}

export interface Prefs {
  language: "en" | "pt" | "es" | "fr" | "de";
  currency: string;
  homeCityId?: string;
  interests: string[];
  budget?: number;
  travel?: "local" | "regional" | "anywhere";
  notifications: Record<string, boolean>;
  shareUsage: boolean;
}

export type FollowKind = "participant" | "venue" | "destination" | "competition" | "category";

export interface SavedSearch {
  id: string;
  name: string;
  /** Search filters as URL parameters (same format as shareable links). */
  params: string;
  summary: string;
  createdAt: string;
}

/**
 * What a saved event looked like when it was saved: enough to show it, and to ask how it was,
 * after it has happened (events leave the catalogue once they're over).
 */
export interface SavedSnap {
  slug: string;
  title: string;
  start: string;
  timeZone: string;
  eventType: string;
  hoursUnknown?: boolean;
  venueName: string;
  /** Where to review it once the event itself is no longer listed. */
  venueSlug?: string;
  imageUrl?: string;
  posterHue?: number;
  categorySlug: string;
}

export interface UserData {
  version: 1;
  searches: SavedSearch[];
  saved: { id: string; at: string; snap?: SavedSnap }[];
  follows: { kind: FollowKind; id: string; name: string; at: string }[];
  trips: Trip[];
  recent: string[]; // event ids
  recentSearches: string[];
  prefs: Prefs;
  onboarded: boolean;
}

const KEY = "omnievent:user:v1";

export const DEFAULT_PREFS: Prefs = {
  language: "en",
  currency: "EUR",
  interests: [],
  notifications: {
    followedPerformers: true,
    newFixtures: true,
    cityAnnouncements: false,
    salesOpening: true,
    priceChanges: false,
    cancellations: true,
    rescheduled: true,
    upcomingSaved: true,
    recommendations: false,
  },
  shareUsage: false,
};

const empty = (): UserData => ({
  version: 1,
  searches: [],
  saved: [],
  follows: [],
  trips: [],
  recent: [],
  recentSearches: [],
  prefs: DEFAULT_PREFS,
  onboarded: false,
});

let data: UserData = empty();
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserData>;
      data = { ...empty(), ...parsed, prefs: { ...DEFAULT_PREFS, ...parsed.prefs, notifications: { ...DEFAULT_PREFS.notifications, ...parsed.prefs?.notifications } } };
    }
  } catch {
    data = empty();
  }
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      loaded = false;
      load();
      emit();
    }
  });
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full / disabled: state stays in memory for this tab
  }
}

function emit() {
  for (const l of listeners) l();
}

function update(fn: (d: UserData) => UserData) {
  load();
  data = fn(data);
  persist();
  emit();
}

const serverSnapshot = empty();

/** For code outside React that follows the trips (the shared-trip sync). */
export function subscribeUser(l: () => void): () => void {
  load();
  listeners.add(l);
  return () => listeners.delete(l);
}
export function getUser(): UserData {
  load();
  return data;
}

export function useUser(): UserData {
  return useSyncExternalStore(
    (l) => {
      load();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => {
      load();
      return data;
    },
    () => serverSnapshot,
  );
}

/**
 * One slice of the user's data, for components shown many times over (a row in a list of 80
 * events): they redraw only when their slice changes, not on every save or follow anywhere.
 * `pick` must return the same value for the same data: a stored array or object as it is, or
 * a plain value (true/false, a string, a number).
 */
export function useUserSelect<T>(pick: (d: UserData) => T): T {
  return useSyncExternalStore(
    (l) => {
      load();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => {
      load();
      return pick(data);
    },
    () => pick(serverSnapshot),
  );
}

const now = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);

export const userActions = {
  toggleSave(id: string, snap?: SavedSnap) {
    update((d) => ({
      ...d,
      saved: d.saved.some((s) => s.id === id) ? d.saved.filter((s) => s.id !== id) : [{ id, at: now(), ...(snap ? { snap } : {}) }, ...d.saved],
    }));
  },
  toggleFollow(kind: FollowKind, id: string, name: string) {
    update((d) => ({
      ...d,
      follows: d.follows.some((f) => f.kind === kind && f.id === id)
        ? d.follows.filter((f) => !(f.kind === kind && f.id === id))
        : [{ kind, id, name, at: now() }, ...d.follows],
    }));
  },
  viewed(id: string) {
    update((d) => ({ ...d, recent: [id, ...d.recent.filter((x) => x !== id)].slice(0, 30) }));
  },
  searched(q: string) {
    const t = q.trim();
    if (!t) return;
    update((d) => ({ ...d, recentSearches: [t, ...d.recentSearches.filter((x) => x !== t)].slice(0, 8) }));
  },
  clearSearches() {
    update((d) => ({ ...d, recentSearches: [] }));
  },
  clearRecent() {
    update((d) => ({ ...d, recent: [] }));
  },
  setPrefs(p: Partial<Prefs>) {
    update((d) => ({ ...d, prefs: { ...d.prefs, ...p } }));
  },
  setOnboarded(v = true) {
    update((d) => ({ ...d, onboarded: v }));
  },
  createTrip(name: string, start?: string, end?: string, eventIds: string[] = [], extra: Partial<Pick<Trip, "stops" | "emoji" | "interests" | "snaps">> = {}): string {
    const id = uid();
    update((d) => ({ ...d, trips: [{ id, name, start, end, eventIds, ...extra, createdAt: now(), updatedAt: now() }, ...d.trips] }));
    return id;
  },
  /** Adds an event to a trip (keeping a copy of it), or takes it out. */
  setTripEvent(tripId: string, event: TripEventSnap & { id: string }, on: boolean) {
    const { id, ...snap } = event;
    update((d) => ({
      ...d,
      trips: d.trips.map((t) => {
        if (t.id !== tripId) return t;
        const has = t.eventIds.includes(id);
        if (on === has) return t;
        const snaps = { ...(t.snaps ?? {}) };
        if (on) snaps[id] = snap;
        else delete snaps[id];
        return { ...t, eventIds: on ? [...t.eventIds, id] : t.eventIds.filter((x) => x !== id), snaps, updatedAt: now() };
      }),
    }));
  },
  updateTrip(id: string, patch: Partial<Omit<Trip, "id" | "createdAt">>) {
    update((d) => ({ ...d, trips: d.trips.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: now() } : t)) }));
  },
  /** A plan of your own on a trip (a flight, a stay…); the same plan again puts it back (Undo). */
  addPlan(tripId: string, plan: TripPlan) {
    update((d) => ({ ...d, trips: d.trips.map((t) => (t.id === tripId ? { ...t, plans: [...(t.plans ?? []).filter((p) => p.id !== plan.id), plan], updatedAt: now() } : t)) }));
  },
  updatePlan(tripId: string, planId: string, patch: Partial<Omit<TripPlan, "id" | "createdAt">>) {
    update((d) => ({ ...d, trips: d.trips.map((t) => (t.id === tripId ? { ...t, plans: (t.plans ?? []).map((p) => (p.id === planId ? { ...p, ...patch } : p)), updatedAt: now() } : t)) }));
  },
  removePlan(tripId: string, planId: string) {
    update((d) => ({ ...d, trips: d.trips.map((t) => (t.id === tripId ? { ...t, plans: (t.plans ?? []).filter((p) => p.id !== planId), updatedAt: now() } : t)) }));
  },
  /** A whole trip arriving on this device (joined from someone else). */
  addTrip(trip: Trip) {
    update((d) => ({ ...d, trips: [trip, ...d.trips.filter((t) => t.id !== trip.id)] }));
  },
  /** Replaces a trip as a whole (the shared-trip sync, after the server's answer). */
  replaceTrip(id: string, fn: (t: Trip) => Trip) {
    update((d) => ({ ...d, trips: d.trips.map((t) => (t.id === id ? fn(t) : t)) }));
  },
  /** An item on one of the trip's lists (a cost, a checklist item, a contact, a traveller): added, or changed. */
  putTripItem<K extends "expenses" | "checklist" | "contacts" | "travellers">(tripId: string, list: K, item: NonNullable<Trip[K]>[number]) {
    update((d) => ({
      ...d,
      trips: d.trips.map((t) => {
        if (t.id !== tripId) return t;
        const cur = (t[list] ?? []) as { id: string }[];
        const i = cur.findIndex((x) => x.id === item.id);
        return { ...t, [list]: i < 0 ? [...cur, item] : cur.map((x, j) => (j === i ? item : x)), updatedAt: now() };
      }),
    }));
  },
  /** A booking's price, kept as the trip's cost for it (no amount: the cost goes). */
  setPlanPrice(tripId: string, plan: TripPlan, amount: number | undefined, currency: string, category: Expense["category"]) {
    update((d) => ({
      ...d,
      trips: d.trips.map((t) => {
        if (t.id !== tripId) return t;
        const list = t.expenses ?? [];
        const was = list.find((e) => e.planId === plan.id);
        if (amount === undefined || !Number.isFinite(amount) || amount <= 0) return was ? { ...t, expenses: list.filter((e) => e !== was), updatedAt: now() } : t;
        const e: Expense = { ...(was ?? {}), id: was?.id ?? `pl${plan.id}`.slice(0, 48), title: plan.title, amount: Math.round(amount * 100) / 100, currency, category: was?.category ?? category, day: plan.day || undefined, planId: plan.id, createdAt: was?.createdAt ?? now() };
        return { ...t, expenses: was ? list.map((x) => (x === was ? e : x)) : [...list, e], updatedAt: now() };
      }),
    }));
  },
  removeTripItem(tripId: string, list: "expenses" | "checklist" | "contacts" | "travellers", itemId: string) {
    update((d) => ({ ...d, trips: d.trips.map((t) => (t.id === tripId ? { ...t, [list]: ((t[list] ?? []) as { id: string }[]).filter((x) => x.id !== itemId), updatedAt: now() } : t)) }));
  },
  deleteTrip(id: string) {
    update((d) => ({ ...d, trips: d.trips.filter((t) => t.id !== id) }));
  },
  toggleTripEvent(tripId: string, eventId: string) {
    update((d) => ({
      ...d,
      trips: d.trips.map((t) =>
        t.id === tripId
          ? { ...t, eventIds: t.eventIds.includes(eventId) ? t.eventIds.filter((x) => x !== eventId) : [...t.eventIds, eventId], updatedAt: now() }
          : t,
      ),
    }));
  },
  saveSearch(name: string, params: string, summary: string): string {
    const id = uid();
    update((d) => ({ ...d, searches: [{ id, name: name.trim().slice(0, 80) || summary, params, summary, createdAt: now() }, ...d.searches].slice(0, 50) }));
    return id;
  },
  deleteSearch(id: string) {
    update((d) => ({ ...d, searches: d.searches.filter((x) => x.id !== id) }));
  },
  exportData(): string {
    load();
    return JSON.stringify(data, null, 2);
  },
  deleteAll() {
    update(() => empty());
  },
};
