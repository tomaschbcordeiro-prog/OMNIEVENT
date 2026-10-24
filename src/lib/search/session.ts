"use client";

import type { SearchFilters } from "../types";
import { filtersToParams, parseFilterParams } from "./params";
import { portableFilters } from "./summary";

/**
 * The current search, remembered for this browser tab so moving between Discover, Events,
 * Categories and Destinations can offer to continue it. URLs stay the source of truth;
 * this only powers the "continue your search" prompt.
 */
const KEY = "omnievent:search:v1";

export function rememberSearch(f: SearchFilters) {
  try {
    const p = filtersToParams(portableFilters(f)).toString();
    if (p) sessionStorage.setItem(KEY, p);
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage unavailable
  }
}

export function recallSearch(): SearchFilters | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = parseFilterParams(new URLSearchParams(raw));
    return p.ok ? p.filters : null;
  } catch {
    return null;
  }
}

export function forgetSearch() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
