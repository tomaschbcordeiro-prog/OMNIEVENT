"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { PublicProfile } from "./types";

/**
 * The browser side of the community: the member secret (kept in this browser only),
 * the member's own profile, and a small fetch helper.
 */

const KEY = "omnievent:member:v1";
const PROFILE_KEY = "omnievent:member-profile:v1";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private mode: works for this visit only
  }
}

let memorySecret: string | null = null;
export function memberSecret(create = false): string | null {
  const s = read(KEY) ?? memorySecret;
  if (s || !create) return s;
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const fresh = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  memorySecret = fresh;
  write(KEY, fresh);
  return fresh;
}

// ---- Own profile store ------------------------------------------------------------------

type State = { profile: PublicProfile | null; loaded: boolean };
let state: State = { profile: null, loaded: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  if (next.profile !== undefined) write(PROFILE_KEY, next.profile ? JSON.stringify(next.profile) : null);
  emit();
}

let loading: Promise<void> | null = null;
function load() {
  if (loading || typeof window === "undefined") return;
  const cached = read(PROFILE_KEY);
  if (cached) {
    try {
      state = { profile: JSON.parse(cached) as PublicProfile, loaded: true };
    } catch {
      // ignore
    }
  }
  loading = (async () => {
    if (!memberSecret()) return setState({ loaded: true, profile: null });
    try {
      const r = await communityGet<{ profile: PublicProfile | null }>("view=me");
      setState({ profile: r.profile, loaded: true });
    } catch {
      setState({ loaded: true });
    }
  })();
}

const SERVER: State = { profile: null, loaded: false };

/** The member's own profile (null until they join). */
export function useMe(): State {
  useEffect(load, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => SERVER,
  );
}

export function setMe(profile: PublicProfile | null) {
  setState({ profile, loaded: true });
}

/** Re-reads the member's profile, e.g. after earning points. */
export async function refreshMe() {
  if (!memberSecret()) return;
  try {
    const r = await communityGet<{ profile: PublicProfile | null }>("view=me");
    setState({ profile: r.profile, loaded: true });
  } catch {
    // keep what we have
  }
}

// ---- API ---------------------------------------------------------------------------------

export class CommunityRequestError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function headers(create: boolean): HeadersInit {
  const s = memberSecret(create);
  return { "Content-Type": "application/json", ...(s ? { "x-omni-member": s } : {}) };
}

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new CommunityRequestError(body.error?.message ?? "Something went wrong. Try again.", res.status);
  return body as T;
}

export async function communityGet<T>(query: string): Promise<T> {
  return parse<T>(await fetch(`/api/community?${query}`, { headers: headers(false), cache: "no-store" }));
}

export async function communityPost<T>(body: Record<string, unknown>): Promise<T> {
  return parse<T>(await fetch("/api/community", { method: "POST", headers: headers(body.action === "profile"), body: JSON.stringify(body) }));
}

/** Short relative time: "now", "5m", "3h", "2d", then a date. */
export function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: s > 300 * 86400 ? "numeric" : undefined });
}
