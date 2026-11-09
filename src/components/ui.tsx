"use client";

import {
  Music, Trophy, Drama, Laugh, Sparkles, Clapperboard, Presentation, Cpu, Frame, FerrisWheel, Utensils, MoonStar,
  Baby, Mountain, GraduationCap, Shirt, Landmark, CircleDot, Bookmark, BookmarkCheck, SearchX, TriangleAlert, Info,
  Expand, X, type LucideIcon,
} from "lucide-react";
import { getCategory, groupOf, GROUP_HEX } from "@/lib/categories";
import { formatMoney, STATUS_META } from "@/lib/format";
import { thumb } from "@/lib/thumb";
import { convert, FX_SOURCE } from "@/lib/currency";
import type { EventStatus } from "@/lib/types";
import { userActions, useUser } from "@/lib/user/store";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
/**
 * An event's main picture, shown whole: never cropped (posters keep their words) and never
 * blown up past a little over its own size (no blur), on a soft backdrop made from the picture
 * itself. Falls back to the drawn poster when it can't load.
 */
export function HeroImage({ src: original, title, hue, categorySlug }: { src: string; title: string; hue?: number; categorySlug: string }) {
  const [broken, setBroken] = useState(false);
  // The picture shown large, over the page.
  const [open, setOpen] = useState(false);
  // At the size it's shown; the original if that can't be made.
  const [full, setFull] = useState(false);
  const src = full ? original : (thumb(original, 480) ?? original);
  const backdrop = thumb(original, 64) ?? original;
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  // A picture that finished loading before the page's script ran has no load event to wait for.
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.naturalWidth) measure(el);
    else if (el?.complete) {
      if (src !== original) setFull(true);
      else setBroken(true);
    }
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps
  if (broken) return <Poster title={title} hue={hue} categorySlug={categorySlug} size="lg" className="h-32 sm:h-40 w-full" />;
  function measure(img: HTMLImageElement) {
    const b = box.current?.getBoundingClientRect();
    if (!b?.width || !img.naturalWidth) return;
    // Fit inside the frame, enlarging small pictures by a third at most.
    const s = Math.min(b.width / img.naturalWidth, b.height / img.naturalHeight, 1.35);
    setFit({ w: Math.min(100, ((img.naturalWidth * s) / b.width) * 100), h: Math.min(100, ((img.naturalHeight * s) / b.height) * 100) });
  }
  return (
    <div ref={box} className="hero-img hero-zoomable aspect-[4/3] sm:aspect-[21/9] max-h-[460px] w-full" onClick={() => setOpen(true)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={backdrop} alt="" aria-hidden className="hero-img-bg" referrerPolicy="no-referrer" decoding="async" />
      <button type="button" className="hero-expand" aria-label={`See the picture of ${title} larger`} onClick={(e) => (e.stopPropagation(), setOpen(true))}>
        <Expand size={16} aria-hidden />
      </button>
      {open && <PictureViewer src={original} preview={src} title={title} onClose={() => setOpen(false)} />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="hero-img-fg"
        style={fit ? { width: `${fit.w}%`, height: `${fit.h}%` } : undefined}
        fetchPriority="high"
        decoding="async"
        referrerPolicy="no-referrer"
        ref={img}
        onLoad={(e) => measure(e.currentTarget)}
        onError={() => (src !== original ? setFull(true) : setBroken(true))}
      />
    </div>
  );
}

/**
 * A picture as large as the screen allows, over a dark backdrop: the resized copy at once,
 * then the original once it has loaded. Closes with Escape, a tap anywhere or the button.
 */
function PictureViewer({ src, preview, title, onClose }: { src: string; preview: string; title: string; onClose: () => void }) {
  const [shown, setShown] = useState(preview);
  const close = useRef<HTMLButtonElement>(null);
  // As large as the screen allows: a small picture is enlarged too (up to three times its
  // own size, past which it would only blur).
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const fit = (img: HTMLImageElement) => {
    if (!img.naturalWidth) return;
    const s = Math.min((window.innerWidth * 0.96) / img.naturalWidth, (window.innerHeight * 0.88) / img.naturalHeight, 3);
    setSize({ w: Math.round(img.naturalWidth * s), h: Math.round(img.naturalHeight * s) });
  };
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // The full picture, swapped in once it's here (it may weigh megabytes).
    const full = new Image();
    full.referrerPolicy = "no-referrer";
    full.onload = () => setShown(src);
    full.src = src;
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      full.onload = null;
      before?.focus();
    };
  }, [src, onClose]);
  // Over everything else on the page, whatever its ancestors do (a moving or isolated parent
  // would hold a fixed layer inside it).
  return createPortal(
    <div className="picture-viewer panel-in" role="dialog" aria-modal="true" aria-label={`Picture: ${title}`} onClick={(e) => (e.stopPropagation(), onClose())}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={shown} alt={title} referrerPolicy="no-referrer" onClick={(e) => e.stopPropagation()} onLoad={(e) => fit(e.currentTarget)} style={size ? { width: size.w, height: size.h } : undefined} />
      <button ref={close} type="button" className="picture-close btn btn-icon" aria-label="Close the picture" onClick={(e) => (e.stopPropagation(), onClose())}>
        <X size={20} aria-hidden />
      </button>
    </div>,
    document.body,
  );
}

/** About how wide each poster size is shown, in CSS pixels (pictures are fetched at about twice that). */
const SHOWN_PX = { sm: 64, md: 280, lg: 560 } as const;

export function Poster({
  imageUrl, hue = 210, categorySlug, className = "", size = "md", priority = false,
}: { title: string; imageUrl?: string; hue?: number; categorySlug: string; className?: string; size?: "sm" | "md" | "lg"; /** The page's main picture: loaded first, not lazily. */ priority?: boolean }) {
  // The picture at the size it's shown; if that fails, the original; if that fails too (moved
  // or blocked by its source), the drawn poster.
  const [stage, setStage] = useState(0);
  const group = groupOf(categorySlug);
  const accent = GROUP_HEX[group] ?? "#9AA8BA";
  const src = stage === 0 ? thumb(imageUrl, SHOWN_PX[size]) : imageUrl;
  if (src && stage < 2)
    // eslint-disable-next-line @next/next/no-img-element
    return <img key={src} src={src} alt="" loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : undefined} decoding="async" referrerPolicy="no-referrer" onError={() => setStage((n) => (n === 0 && src !== imageUrl ? 1 : 2))} className={`object-cover bg-panel-2 ${className}`} />;
  const Icon = ICONS[getCategory(group)?.icon ?? "circle-dot"] ?? CircleDot;
  return (
    <div
      aria-hidden
      className={`poster-art relative overflow-hidden ${className}`}
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

/** Statuses worth flagging on a card or list: the ones that change whether you can go. */
const NOTABLE_STATUS = new Set<EventStatus>(["sold_out", "postponed", "rescheduled", "cancelled", "completed"]);

/** `quiet`: only show the statuses that matter (in lists and cards), not "On sale" or "Scheduled". */
export function StatusBadge({ status, className = "", quiet = false }: { status: EventStatus; className?: string; quiet?: boolean }) {
  if (quiet && !NOTABLE_STATUS.has(status)) return null;
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
  amount, currency, feesIncluded, from = true, isFree, displayCurrency, className = "", quiet = false,
}: { amount?: number; currency?: string; feesIncluded?: boolean; from?: boolean; isFree?: boolean; displayCurrency?: string; className?: string; /** Lists: say nothing when the price isn't known. */ quiet?: boolean }) {
  if (isFree) return <span className={`text-ok font-semibold ${className}`}>Free</span>;
  if (amount == null || !currency) return quiet ? null : <span className={`text-text-3 ${className}`}>Price not available</span>;
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
  // A ring that ripples out from the button the moment something is saved.
  const [burst, setBurst] = useState(0);
  return (
    <button
      type="button"
      aria-pressed={saved}
      // Alternating names restart the ripple without remounting (focus stays put).
      data-burst={burst ? (burst % 2 ? "a" : "b") : undefined}
      aria-label={saved ? `Remove ${title} from saved` : `Save ${title}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        userActions.toggleSave(id);
        if (!saved) setBurst((n) => n + 1);
        toast(saved ? { title: "Removed from saved", emoji: "🗑️" } : { title: "Saved", body: title, emoji: "🔖", href: "/my-world", linkLabel: "My World" });
      }}
      className={`save-btn btn press ${compact ? "btn-sm btn-icon" : "btn-secondary btn-sm"} ${saved ? "text-cyan" : compact ? "btn-ghost" : ""} ${className}`}
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
