/**
 * Editing one end of a date range keeps the range sensible: picking a start fills in the
 * end with the same day when it's empty or earlier (so the end's calendar opens there), and
 * an end before the start moves the start back to it.
 */
export function setRangeEdge(edge: "from" | "to", value: string | undefined, cur: { from?: string; to?: string }): { from?: string; to?: string } {
  const v = value || undefined;
  if (edge === "from") return { from: v, to: v && (!cur.to || cur.to < v) ? v : cur.to };
  return { from: v && cur.from && v < cur.from ? v : cur.from, to: v };
}
