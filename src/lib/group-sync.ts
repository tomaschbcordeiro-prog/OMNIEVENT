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
  here?: string[];
}

const states = new Map<string, SyncState>();
const stateListeners = new Set<() => void>();
const setState = (id: string, s: SyncState) => {
  if (states.get(id) === s) return;
  states.set(id, s);
  stateListeners.forEach((l) => l());
};

// Who has each trip open right now (member ids), as the server last said.
const present = new Map<string, string[]>();
const setPresent = (id: string, ids: string[] | undefined) => {
  if (!ids) return;
  const was = present.get(id);
  if (was && was.length === ids.length && was.every((x, i) => x === ids[i])) return;
  present.set(id, ids);
  stateListeners.forEach((l) => l());
};
const NOBODY: string[] = [];
/** Who has this shared trip open right now. */
export function usePresence(tripId: string): string[] {
  return useSyncExternalStore(
    (l) => {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
    () => present.get(tripId) ?? NOBODY,
    () => NOBODY,
  );
}
/** When news last came from someone else (to ask for news more often while things move). */
const lastNews = new Map<string, number>();

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

function linkFrom(view: PeerView, key: string, was?: GroupLink): GroupLink {
  return {
    id: view.id, key, me: view.me, role: view.role, v: view.v, base: view.content, members: view.members, code: view.code, invite: view.invite, open: view.open, log: view.log, syncedAt: new Date().toISOString(),
    ...(view.testMode ? { testMode: true } : {}),
    // This device's own bookmarks: when the trip was last opened, the chat last read.
    ...(was?.lastOpened ? { lastOpened: was.lastOpened } : {}),
    ...(was?.lastRead ? { lastRead: was.lastRead } : {}),
  };
}

/** Changes that a viewer may still send: their messages in the chat. */
const chatOnly = (ops: ReturnType<typeof diffContent>) => ops.filter((op) => op.t !== "set" && op.c === "messages" && op.t !== "order");

/** The server's version in place on this device, with what was done here meanwhile kept on top. */
function merge(tripId: string, view: PeerView, sent?: TripContent) {
  userActions.replaceTrip(tripId, (t) => {
    if (!t.group) return t;
    const here = contentOf(t);
    // A viewer's own edits can't go anywhere (only their messages): the server's trip is the trip.
    const all = diffContent(sent ?? t.group.base, here);
    const pending = t.group.role === "viewer" || view.role === "viewer" ? chatOnly(all) : all;
    const content = pending.length ? applyOps(view.content, pending) : view.content;
    return { ...withContent(t, content), group: linkFrom(view, t.group.key, t.group) };
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
  const sent = contentOf(t);
  const all = diffContent(t.group.base, sent);
  const ops = t.group.role === "viewer" ? chatOnly(all) : all;
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
    setPresent(tripId, data.here);
    if (!data.same) {
      tellNews(t, data);
      merge(tripId, data);
    }
    if (states.get(tripId) !== "saving") setState(tripId, "saved");
  } catch {
    setState(tripId, "offline");
  }
}

/** What others just did, said in a line as it arrives ("Ana added Hotel"), and their new messages. */
function tellNews(t: Trip, view: PeerView) {
  const g = t.group;
  if (!g) return;
  const myName = g.members.find((m) => m.id === g.me)?.name;
  const lastAt = g.log[g.log.length - 1]?.at ?? "";
  const fresh = view.log.filter((l) => l.at > lastAt && l.by !== myName);
  const known = new Set((g.base.messages ?? []).map((m) => m.id));
  const said = (view.content.messages ?? []).filter((m) => !known.has(m.id) && m.by !== g.me);
  if (fresh.length || said.length) lastNews.set(t.id, Date.now());
  if (said.length) {
    const m = said[said.length - 1];
    toast({ title: m.name, body: m.text.length > 120 ? `${m.text.slice(0, 117)}…` : m.text, emoji: "💬", action: { label: "Reply", run: () => window.dispatchEvent(new CustomEvent("omni:trip-chat", { detail: t.id })) } });
  } else if (fresh.length) {
    const l = fresh[fresh.length - 1];
    toast({ title: `${l.by} ${l.text}`, body: fresh.length > 1 ? `and ${fresh.length - 1} more ${fresh.length === 2 ? "change" : "changes"}` : undefined, emoji: "✨" });
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
    // Often while others are here, things are moving, or the trip was just opened (people are
    // joining, answering); calmly otherwise (it saves the server work).
    let timer = 0;
    const opened = Date.now();
    const loop = () => {
      const t = tripOf(tripId);
      const others = (present.get(tripId) ?? []).some((id) => id !== t?.group?.me);
      const busy = Date.now() - (lastNews.get(tripId) ?? 0) < 120_000 || Date.now() - opened < 180_000;
      timer = window.setTimeout(() => (tick(), loop()), others || busy ? 5000 : 20000);
    };
    loop();
    const onVis = () => tick();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [tripId, shared]);
}

// ---------------------------------------------------------------- the actions

/** A message in the trip's chat (the server signs it with the sender's name). */
export function sendMessage(tripId: string, text: string) {
  const t = tripOf(tripId);
  const clean = text.trim().slice(0, 1000);
  if (!t?.group || !clean) return;
  const me = t.group.members.find((m) => m.id === t.group!.me);
  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  userActions.replaceTrip(tripId, (x) => ({ ...x, messages: [...(x.messages ?? []), { id, by: t.group!.me, name: me?.name ?? "", text: clean, at: new Date().toISOString() }], group: x.group ? { ...x.group, lastRead: new Date().toISOString() } : x.group }));
}

/** Marks the chat read, and the trip opened, on this device. */
export function markSeen(tripId: string, what: "chat" | "trip") {
  userActions.replaceTrip(tripId, (x) => (x.group ? { ...x, group: { ...x.group, ...(what === "chat" ? { lastRead: new Date().toISOString() } : { lastOpened: new Date().toISOString() }) } } : x));
}

/** The latest of every shared trip on this device, once (the trips page, on arrival). */
export function useRefreshShared(ids: string[]) {
  const key = ids.join(",");
  useEffect(() => {
    start();
    const all = () => document.visibilityState === "visible" && (key ? key.split(",") : []).forEach((id) => void pull(id));
    all();
    // And again now and then while the page is open, and on coming back to it.
    const iv = window.setInterval(all, 30_000);
    document.addEventListener("visibilitychange", all);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", all);
    };
  }, [key]);
}

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
