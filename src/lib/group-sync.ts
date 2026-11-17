"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getUser, subscribeUser, userActions, type GroupLink, type Trip } from "./user/store";
import { applyOps, contentOf, diffContent, withContent, type TripContent } from "./trip-share";
import { toast } from "@/components/toast";

/*
 * Keeping a trip planned together the same on every device.
 *
 * Each device edits its own copy as always (every button on the trip pages keeps working).
 * Here, whatever changed since the last version from the server is worked out, sent as small
 * changes a moment later, and the server's answer comes back with everyone else's changes;
 * anything done meanwhile is put back on top. While a trip is open it asks for news every
 * few seconds (only when the page is visible), and right away when the page comes back.
 * Offline, changes wait on the device and go when the connection returns.
 */

export type SyncState = "saved" | "saving" | "offline" | "error";
interface PeerView {
  id: string;
  v: number;
  content: TripContent;
  members: GroupLink["members"];
  me: string;
  role: GroupLink["role"];
  code?: string;
  invite?: string;
  open: boolean;
  log: GroupLink["log"];
  testMode?: boolean;
}

const states = new Map<string, SyncState>();
const stateListeners = new Set<() => void>();
const setState = (id: string, s: SyncState) => {
  if (states.get(id) === s) return;
  states.set(id, s);
  stateListeners.forEach((l) => l());
};

/** How a shared trip's sync is doing: saved, saving, offline (waiting) or a problem. */
export function useSyncState(tripId: string): SyncState {
  return useSyncExternalStore(
    (l) => {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
    () => states.get(tripId) ?? "saved",
    () => "saved",
  );
}

class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function call<T>(body: Record<string, unknown>, key?: string): Promise<T> {
  const res = await fetch("/api/group-trips", { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-trip-key": key } : {}) }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) throw new ApiError(data.error?.message ?? "Something went wrong. Please try again.", res.status);
  return data;
}

const tripOf = (id: string) => getUser().trips.find((t) => t.id === id);

function linkFrom(view: PeerView, key: string): GroupLink {
  return { id: view.id, key, me: view.me, role: view.role, v: view.v, base: view.content, members: view.members, code: view.code, invite: view.invite, open: view.open, log: view.log, syncedAt: new Date().toISOString(), ...(view.testMode ? { testMode: true } : {}) };
}

/** The server's version in place on this device, with what was done here meanwhile kept on top. */
function merge(tripId: string, view: PeerView, sent?: TripContent) {
  userActions.replaceTrip(tripId, (t) => {
    if (!t.group) return t;
    const here = contentOf(t);
    // A viewer's own edits can't go anywhere: the server's trip is the trip.
    const pending = t.group.role === "viewer" || view.role === "viewer" ? [] : diffContent(sent ?? t.group.base, here);
    const content = pending.length ? applyOps(view.content, pending) : view.content;
    return { ...withContent(t, content), group: linkFrom(view, t.group.key) };
  });
}

/** Out of the trip (taken out, or sharing stopped): the copy stays here, on its own. */
function gone(tripId: string, why: string) {
  userActions.replaceTrip(tripId, (t) => ({ ...t, group: undefined }));
  states.delete(tripId);
  toast({ title: "No longer shared", body: `${why} Your copy stays on this device.`, emoji: "🔒" });
}

const inflight = new Set<string>();
const timers = new Map<string, number>();
const retry = new Map<string, number>();

async function flush(tripId: string) {
  const t = tripOf(tripId);
  if (!t?.group || inflight.has(tripId)) return;
  if (t.group.role === "viewer") return;
  const sent = contentOf(t);
  const ops = diffContent(t.group.base, sent);
  if (!ops.length) return setState(tripId, "saved");
  if (typeof navigator !== "undefined" && !navigator.onLine) return setState(tripId, "offline");
  inflight.add(tripId);
  setState(tripId, "saving");
  try {
    const { view } = await call<{ view: PeerView }>({ action: "change", id: t.group.id, ops }, t.group.key);
    merge(tripId, view, sent);
    retry.delete(tripId);
    setState(tripId, "saved");
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      if (/not change/.test(err.message)) {
        // Made a viewer meanwhile: take the server's trip as it is.
        await pull(tripId, true);
      } else gone(tripId, err.message);
    } else {
      setState(tripId, err instanceof ApiError ? "error" : "offline");
      const n = (retry.get(tripId) ?? 0) + 1;
      retry.set(tripId, n);
      // A little longer each time, up to a minute.
      window.setTimeout(() => schedule(tripId, 0), Math.min(60_000, 2000 * 2 ** n));
    }
  } finally {
    inflight.delete(tripId);
  }
  // Changed again while sending: send that too.
  const again = tripOf(tripId);
  if (again?.group && diffContent(again.group.base, contentOf(again)).length) schedule(tripId);
}

function schedule(tripId: string, delay = 650) {
  window.clearTimeout(timers.get(tripId));
  timers.set(tripId, window.setTimeout(() => void flush(tripId), delay));
}

/** News from the server (others' changes). */
export async function pull(tripId: string, force = false) {
  const t = tripOf(tripId);
  if (!t?.group || inflight.has(tripId)) return;
  try {
    const res = await fetch(`/api/group-trips?id=${encodeURIComponent(t.group.id)}${force ? "" : `&since=${t.group.v}`}`, { headers: { "x-trip-key": t.group.key }, cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { same?: boolean; error?: { message?: string } } & PeerView;
    if (res.status === 403 || res.status === 404) return gone(tripId, data.error?.message ?? "This trip isn't shared any more.");
    if (!res.ok) return setState(tripId, "error");
    if (!data.same) merge(tripId, data);
    if (states.get(tripId) !== "saving") setState(tripId, "saved");
  } catch {
    setState(tripId, "offline");
  }
}

// Every change on this device: the shared trips among them get sent.
let started = false;
const lastSeen = new Map<string, Trip>();
function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const check = () => {
    for (const t of getUser().trips) {
      if (!t.group) continue;
      if (lastSeen.get(t.id) === t) continue;
      lastSeen.set(t.id, t);
      if (!inflight.has(t.id) && diffContent(t.group.base, contentOf(t)).length) {
        setState(t.id, navigator.onLine ? "saving" : "offline");
        schedule(t.id);
      }
    }
  };
  subscribeUser(check);
  check();
  window.addEventListener("online", () => {
    for (const t of getUser().trips) if (t.group) schedule(t.id, 0);
  });
}

/** While a shared trip is open: its changes go out, and news comes in every few seconds. */
export function useGroupSync(tripId: string | undefined, shared: boolean) {
  useEffect(() => {
    start();
    if (!tripId || !shared) return;
    void pull(tripId);
    const tick = () => document.visibilityState === "visible" && void pull(tripId);
    const iv = window.setInterval(tick, 8000);
    const onVis = () => tick();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [tripId, shared]);
}

// ---------------------------------------------------------------- the actions

/** Starts planning a trip together. */
export async function startSharing(tripId: string, name: string) {
  const t = tripOf(tripId);
  if (!t) throw new Error("This trip isn't on this device.");
  const { key, view } = await call<{ key: string; view: PeerView }>({ action: "create", content: contentOf(t), name });
  userActions.replaceTrip(tripId, (x) => ({ ...withContent(x, view.content), group: linkFrom(view, key) }));
  setState(tripId, "saved");
  start();
}

export interface Peek {
  id: string;
  name: string;
  emoji: string;
  start?: string;
  end?: string;
  cities: string[];
  people: number;
  by: string;
}

/** What a link or PIN leads to, before joining. */
export async function peekTrip(by: { invite?: string; code?: string }): Promise<Peek> {
  return (await call<{ trip: Peek }>({ action: "peek", ...by })).trip;
}

/** Comes into a trip with its link or PIN; the trip lands on this device. Returns its id here. */
export async function joinTrip(by: { invite?: string; code?: string }, name: string): Promise<string> {
  const { key, view } = await call<{ key: string; view: PeerView }>({ action: "join", ...by, name });
  // Already in it on this device (a second key): the newest key wins.
  const now = new Date().toISOString();
  const existing = getUser().trips.find((t) => t.group?.id === view.id);
  if (existing) {
    userActions.replaceTrip(existing.id, (x) => ({ ...withContent(x, view.content), group: linkFrom(view, key) }));
    return existing.id;
  }
  const trip: Trip = { ...withContent({ id: view.id, name: view.content.name, eventIds: [], createdAt: now, updatedAt: now } as Trip, view.content), group: linkFrom(view, key) };
  userActions.addTrip(trip);
  start();
  return trip.id;
}

/** People, roles, the link and PIN, leaving. */
export async function manageTrip(tripId: string, action: Record<string, unknown>) {
  const t = tripOf(tripId);
  if (!t?.group) return;
  const { view } = await call<{ view: PeerView | { left: true } }>({ action: "manage", id: t.group.id, ...action }, t.group.key);
  if ("left" in view) {
    userActions.replaceTrip(tripId, (x) => ({ ...x, group: undefined }));
    states.delete(tripId);
    return;
  }
  merge(tripId, view);
}

/** Stops sharing: the trip leaves the server; this copy stays. */
export async function stopSharing(tripId: string) {
  const t = tripOf(tripId);
  if (!t?.group) return;
  await call({ action: "stop", id: t.group.id }, t.group.key);
  userActions.replaceTrip(tripId, (x) => ({ ...x, group: undefined }));
  states.delete(tripId);
}

/** The name this device goes by in shared trips (remembered). */
export function rememberedName(): string {
  try {
    return localStorage.getItem("omnievent:trip-name") ?? "";
  } catch {
    return "";
  }
}
export function rememberName(name: string) {
  try {
    localStorage.setItem("omnievent:trip-name", name.trim().slice(0, 40));
  } catch {
    // private mode: asked again next time
  }
}

/** A link others can open to join. */
export const inviteLink = (invite: string) => `${window.location.origin}/trips/join/${invite}`;
/** "K7QM2XPA" → "K7QM-2XPA". */
export const prettyPin = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
