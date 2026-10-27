"use client";

import { useState } from "react";
import { setRangeEdge } from "@/lib/date-range";

/** Start and end date fields for a plain form (submitted by name), kept in order as they change. */
export function DateRangeFields({ from, to, names, labels, idPrefix }: { from?: string; to?: string; names: [string, string]; labels: [string, string]; idPrefix: string }) {
  const [r, setR] = useState<{ from?: string; to?: string }>({ from, to });
  return (
    <>
      <div>
        <label className="label" htmlFor={`${idPrefix}-from`}>{labels[0]}</label>
        <input id={`${idPrefix}-from`} name={names[0]} type="date" className="field" value={r.from ?? ""} onChange={(e) => setR((c) => setRangeEdge("from", e.target.value, c))} />
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-to`}>{labels[1]}</label>
        <input id={`${idPrefix}-to`} name={names[1]} type="date" className="field" min={r.from} value={r.to ?? ""} onChange={(e) => setR((c) => setRangeEdge("to", e.target.value, c))} />
      </div>
    </>
  );
}
