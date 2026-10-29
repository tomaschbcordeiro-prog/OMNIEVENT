"use client";

import {
  Music, Trophy, Drama, Laugh, Sparkles, Clapperboard, Presentation, Cpu, Frame, FerrisWheel, Utensils, MoonStar,
  Baby, Mountain, GraduationCap, Shirt, Landmark, CircleDot, Bookmark, BookmarkCheck, SearchX, TriangleAlert, Info,
  type LucideIcon,
} from "lucide-react";
import { getCategory, groupOf, GROUP_HEX } from "@/lib/categories";
import { formatMoney, STATUS_META } from "@/lib/format";
import { convert, FX_SOURCE } from "@/lib/currency";
import type { EventStatus } from "@/lib/types";
import { userActions, useUser } from "@/lib/user/store";
import { useState } from "react";
import { toast } from "./toast";
import type { ReactNode } from "react";

export const ICONS: Record<string, LucideIcon> = {
  music: Music, trophy: Trophy, drama: Drama, laugh: Laugh, sparkles: Sparkles, clapperboard: Clapperboard,
  presentation: Presentation, cpu: Cpu, frame: Frame, "ferris-wheel": FerrisWheel, utensils: Utensils,
  "moon-star": MoonStar, baby: Baby, mountain: Mountain, "graduation-cap": GraduationCap, shirt: Shirt,
  landmark: Landmark, "circle-dot": CircleDot,
};

export function categoryLabel(slug: string): string {
  return getCategory(slug)?.name ?? slug;
}

export function CategoryIcon({ slug, size = 16, className = "" }: { slug: string; size?: number; className?: string }) {
  const group = groupOf(slug);
  const Icon = ICONS[getCategory(group)?.icon ?? "circle-dot"] ?? CircleDot;
  return <Icon aria-hidden size={size} className={className} style={{ color: GROUP_HEX[group] }} strokeWidth={1.75} />;
}

/**
 * Category glyph matching the map markers: a disc in the category colour. From 13 px up it
 * carries the category icon in white, so colour is never the only cue.
 */
export function ShapeGlyph({ group, size = 10 }: { group: string; size?: number }) {
  const c = GROUP_HEX[group] ?? GROUP_HEX.other;
  const Icon = ICONS[getCategory(group)?.icon ?? "circle-dot"] ?? CircleDot;
  return (
    <span aria-hidden className="inline-grid place-items-center shrink-0 rounded-full" style={{ width: size, height: size, background: c, boxShadow: size >= 13 ? "0 0 0 1.5px #fff, 0 1px 3px rgb(13 27 51 / 0.3)" : undefined }}>
      {size >= 13 && <Icon size={Math.round(size * 0.6)} color="#fff" strokeWidth={2.4} />}
    </span>
  );
}

/**
 * Event artwork. Real provider images are shown when present; otherwise a
 * generated poster (no stock photos pretending to be the event).
 */
export function Poster({
  imageUrl, hue = 210, categorySlug, className = "", size = "md", priority = false,
}: { title: string; imageUrl?: string; hue?: number; categorySlug: string; className?: string; size?: "sm" | "md" | "lg"; /** The page's main picture: loaded first, not lazily. */ priority?: boolean }) {
  // A picture that fails to load (moved or blocked by its source) falls back to the drawn poster.
  const [broken, setBroken] = useState(false);
  const group = groupOf(categorySlug);
  const accent = GROUP_HEX[group] ?? "#9AA8BA";
  if (imageUrl && !broken)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : undefined} decoding="async" onError={() => setBroken(true)} className={`object-cover bg-panel-2 ${className}`} />;
  const Icon = ICONS[getCategory(group)?.icon ?? "circle-dot"] ?? CircleDot;
  return (
    <div
      aria-hidden
      className={`relative overflow-hidden ${className}`}
      style={{
        background: `radial-gradient(120% 90% at 85% 10%, ${accent}55 0%, transparent 60%), linear-gradient(160deg, hsl(${hue} 85% 94%) 0%, hsl(${(hue + 40) % 360} 75% 86%) 100%)`,
      }}
    >
      <Icon
        className="absolute"
        strokeWidth={1}
        style={{
          color: accent,
          opacity: 0.8,
          width: size === "lg" ? 120 : size === "sm" ? 28 : 56,
          height: size === "lg" ? 120 : size === "sm" ? 28 : 56,
          right: size === "sm" ? 6 : 14,
          bottom: size === "sm" ? 6 : 12,
        }}
      />
    </div>
  );
}

const TONE: Record<string, string> = {
  ok: "text-ok bg-ok/10 border-ok/30",
  warn: "text-warn bg-warn/10 border-warn/30",
  bad: "text-bad bg-bad/10 border-bad/30",
  info: "text-cyan bg-cyan/10 border-cyan/30",
  muted: "text-text-2 bg-text/5 border-line-strong",
};

export function StatusBadge({ status, className = "" }: { status: EventStatus; className?: string }) {
  const m = STATUS_META[status];
  return <span className={`inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold border ${TONE[m.tone]} ${className}`}>{m.label}</span>;
}

export function Tone({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return <span className={`inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold border ${TONE[tone]}`}>{children}</span>;
}

export function DemoBadge({ title = "Fictional demonstration data — not a real event" }: { title?: string }) {
  return (
    <span className="demo-badge" title={title}>
      Demo
    </span>
  );
}

/** Advertised price with honest qualifiers and an optional labelled conversion. */
export function Price({
  amount, currency, feesIncluded, from = true, isFree, displayCurrency, className = "",
}: { amount?: number; currency?: string; feesIncluded?: boolean; from?: boolean; isFree?: boolean; displayCurrency?: string; className?: string }) {
  if (isFree) return <span className={`text-ok font-semibold ${className}`}>Free</span>;
  if (amount == null || !currency) return <span className={`text-text-3 ${className}`}>Price not available</span>;
  const converted = displayCurrency && displayCurrency !== currency ? convert(amount, currency, displayCurrency) : undefined;
  return (
    <span className={`tnum ${className}`}>
      {from && <span className="text-text-3 font-normal">from </span>}
      <span className="font-semibold text-text">{formatMoney(amount, currency)}</span>
      {feesIncluded === false && <span className="text-text-3 font-normal"> + fees</span>}
      {converted != null && (
        <span className="text-text-3 font-normal" title={`Estimate using ${FX_SOURCE.name}, ${FX_SOURCE.asOf}`}>
          {" "}(≈ {formatMoney(Math.round(converted), displayCurrency!)})
        </span>
      )}
    </span>
  );
}

export function SaveButton({ id, title, compact = false, className = "" }: { id: string; title: string; compact?: boolean; className?: string }) {
  const user = useUser();
  const saved = user.saved.some((s) => s.id === id);
  const Icon = saved ? BookmarkCheck : Bookmark;
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? `Remove ${title} from saved` : `Save ${title}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        userActions.toggleSave(id);
        toast(saved ? { title: "Removed from saved", emoji: "🗑️" } : { title: "Saved", body: title, emoji: "🔖", href: "/my-world", linkLabel: "My World" });
      }}
      className={`btn press ${compact ? "btn-sm btn-icon" : "btn-secondary btn-sm"} ${saved ? "text-cyan" : compact ? "btn-ghost" : ""} ${className}`}
    >
      <Icon key={String(saved)} size={15} aria-hidden fill={saved ? "currentColor" : "none"} className={saved ? "pop" : undefined} />
      {!compact && (saved ? "Saved" : "Save")}
    </button>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-[var(--radius-l)] border border-dashed border-line-strong p-8">
      <SearchX size={22} className="text-text-3" aria-hidden />
      <div>
        <p className="t-h3">{title}</p>
        {body && <div className="t-small text-text-2 mt-1 measure">{body}</div>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ title, body, onRetry }: { title: string; body?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-[var(--radius-m)] border border-bad/30 bg-bad/5 p-4">
      <TriangleAlert size={18} className="text-bad mt-0.5 shrink-0" aria-hidden />
      <div className="flex-1">
        <p className="font-semibold t-small">{title}</p>
        {body && <p className="t-small text-text-2 mt-0.5">{body}</p>}
      </div>
      {onRetry && (
        <button className="btn btn-secondary btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "demo" }) {
  return (
    <div className={`flex items-start gap-2.5 rounded-[var(--radius-m)] border p-3 t-small ${tone === "demo" ? "border-amber/30 bg-amber/5 text-text-2" : "border-line-strong bg-panel text-text-2"}`}>
      <Info size={16} className={`mt-0.5 shrink-0 ${tone === "demo" ? "text-warn" : "text-cyan"}`} aria-hidden />
      <div>{children}</div>
    </div>
  );
}
