"use client";

import { BedDouble, Landmark, Plane, Plus, TrainFront, UtensilsCrossed } from "lucide-react";
import { openAdd, type AddKind } from "./add-bus";

/*
 * Where adding starts, made obvious: a big "+ Add" bar that opens the trip's Add sheet, and
 * the kinds of thing most added, a tap away.
 */

const KINDS: { kind: AddKind; label: string; Icon: typeof Plus; color: string }[] = [
  { kind: "place", label: "Place", Icon: Landmark, color: "#c2650a" },
  { kind: "food", label: "Food", Icon: UtensilsCrossed, color: "#e5484d" },
  { kind: "stay", label: "Hotel", Icon: BedDouble, color: "#7b4dff" },
  { kind: "flight", label: "Flight", Icon: Plane, color: "#1463ff" },
  { kind: "train", label: "Train", Icon: TrainFront, color: "#0f9f73" },
];

export function AddBar({ title, sub, stopId, day }: { title: string; sub: string; stopId?: string; day?: string | null }) {
  return (
    <div className="add-bar">
      <button type="button" className="add-bar-main press" onClick={() => openAdd({ stopId, day })}>
        <span className="add-bar-plus" aria-hidden><Plus size={20} strokeWidth={2.5} /></span>
        <span className="min-w-0 flex-1">
          <span className="add-bar-title">{title}</span>
          <span className="add-bar-sub">{sub}</span>
        </span>
      </button>
      <div className="add-bar-kinds" role="group" aria-label="Or add straight away">
        {KINDS.map(({ kind, label, Icon, color }) => (
          <button key={kind} type="button" className="add-bar-kind" style={{ "--k": color } as React.CSSProperties} onClick={() => openAdd({ stopId, day, kind })} aria-label={`Add a ${label.toLowerCase()}`}>
            <Icon size={14} aria-hidden /> {label}
          </button>
        ))}
      </div>
    </div>
  );
}
