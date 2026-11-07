"use client";

import type { CSSProperties } from "react";
import { Pencil } from "lucide-react";

/** One reel: the tape wound round it, the hub and its six teeth. Spins while the tape plays. */
function Reel({ cx, cy, tape }: { cx: number; cy: number; tape: number }) {
  return (
    <g className="cassette-reel" transform={`translate(${cx} ${cy})`}>
      <g className="cassette-reel-spin">
        <circle r={tape} fill="#3b2f25" style={{ transition: "r 600ms ease" }} />
        <circle r={tape - 1.5} fill="none" stroke="#4d3d30" strokeWidth="1" style={{ transition: "r 600ms ease" }} />
        <circle r="15" fill="#f4efe4" />
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <rect key={a} x="-2.2" y="-15" width="4.4" height="6.5" rx="1" fill="#141826" transform={`rotate(${a})`} />
        ))}
        <circle r="5" fill="#141826" />
      </g>
    </g>
  );
}

/**
 * The tape: a cassette whose label carries the tape's name (editable in place) and whose
 * reels spin while it records or plays. `progress` (0–1) moves the tape from the left reel
 * to the right one.
 */
export function Cassette({
  name,
  placeholder,
  onName,
  sub,
  hue,
  spinning,
  progress = 0.35,
  side = "A",
}: {
  name: string;
  placeholder: string;
  onName: (s: string) => void;
  sub: string;
  hue: number;
  spinning: boolean;
  progress?: number;
  side?: string;
}) {
  const left = 16 + 15 * (1 - progress);
  const right = 16 + 15 * progress;
  return (
    <div className="cassette" data-spinning={spinning || undefined} style={{ "--tape-hue": hue } as CSSProperties}>
      <svg viewBox="0 0 440 280" className="cassette-svg" aria-hidden>
        <defs>
          <linearGradient id="cs-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a3046" />
            <stop offset="1" stopColor="#141826" />
          </linearGradient>
          <linearGradient id="cs-glass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1a1f2e" />
            <stop offset="1" stopColor="#07090f" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="436" height="276" rx="22" fill="url(#cs-body)" stroke="rgba(255,255,255,.16)" strokeWidth="2" />
        {[[18, 18], [422, 18], [18, 262], [422, 262], [220, 262]].map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y} r="6" fill="#0c0f18" />
            <path d={`M${x - 3.5} ${y}h7M${x} ${y - 3.5}v7`} stroke="#59607d" strokeWidth="1.6" />
          </g>
        ))}
        {/* The label */}
        <rect x="30" y="24" width="380" height="182" rx="12" fill="#fbf6ea" />
        <path d="M42 24h356a12 12 0 0 1 12 12v22H30V36a12 12 0 0 1 12-12z" className="cassette-band" />
        <text x="48" y="46" fontSize="12.5" fontWeight="800" fill="#fff" letterSpacing="2.4">OMNIEVENT · MIXTAPE</text>
        <text x="394" y="48" fontSize="20" fontWeight="900" fill="#fff" textAnchor="end">{side}</text>
        <text x="48" y="118" fontSize="12.5" fill="#6b6253" fontWeight="600">{sub}</text>
        <path d="M48 101h344" stroke="#e8dfcb" strokeWidth="1.2" />
        {/* The window and its reels */}
        <rect x="104" y="128" width="232" height="66" rx="33" fill="url(#cs-glass)" stroke="#0b0d14" strokeWidth="2" />
        <path d={`M160 ${161 + left}L280 ${161 + right}`} stroke="#3b2f25" strokeWidth="3" style={{ transition: "d 600ms ease" }} />
        <Reel cx={160} cy={161} tape={left} />
        <Reel cx={280} cy={161} tape={right} />
        <rect x="104" y="128" width="232" height="18" rx="9" fill="#fff" opacity=".06" />
        {/* The head opening */}
        <path d="M110 278l20-46h180l20 46" fill="#0f121c" stroke="rgba(255,255,255,.1)" strokeWidth="2" />
        <circle cx="165" cy="256" r="6" fill="#05070c" />
        <circle cx="275" cy="256" r="6" fill="#05070c" />
        <rect x="204" y="246" width="32" height="14" rx="3" fill="#05070c" />
      </svg>
      <label className="cassette-name">
        <span className="sr-only">Name your tape</span>
        <input value={name} placeholder={placeholder} maxLength={60} onChange={(e) => onName(e.target.value)} spellCheck={false} />
        <Pencil size={14} aria-hidden className="cassette-pencil" />
      </label>
    </div>
  );
}
