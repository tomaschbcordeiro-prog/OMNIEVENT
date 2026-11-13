import type { TripPlan } from "@/lib/trip-plans";
import type { Draft } from "./agenda";
import type { Picking } from "./add-sheet";

/*
 * Asking for the trip's one "Add" sheet from anywhere on the trip's page (its header, a day's
 * "+", a city's page, a sight's card, the show): what to add, and where and when if it's known.
 */

export type AddKind = "place" | "food" | "stay" | "flight" | "train" | "meeting" | "note";

export interface AddRequest {
  /** The city it's for. */
  stopId?: string;
  /** The day it's for. */
  day?: string | null;
  /** What it is, when it's known (a tile already chosen). */
  kind?: AddKind;
  /** A place already chosen (a sight's card): straight to "when". */
  picking?: Picking;
  /** A plan already filled in (a journey suggested): straight to its details. */
  draft?: Draft;
  /** A plan to change. */
  edit?: TripPlan;
  /** Words already typed. */
  query?: string;
}

export const ADD_EVENT = "omni:add";

export function openAdd(r: AddRequest = {}) {
  window.dispatchEvent(new CustomEvent<AddRequest>(ADD_EVENT, { detail: r }));
}
