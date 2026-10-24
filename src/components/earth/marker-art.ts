import type { LucideIcon } from "lucide-react";
import { getCategory, GROUP_HEX } from "@/lib/categories";
import { ICONS } from "../ui";
import { CircleDot } from "lucide-react";

/**
 * Marker artwork for the map, drawn once per category on a canvas and handed to MapLibre
 * as images, so thousands of markers render on the GPU instead of as DOM elements.
 *
 * Visual language (shared with the legend and category chips):
 * - single event: a white rim around a disc in the category colour, with the category's
 *   Lucide icon in white;
 * - cluster: a white disc that carries the count, a ring whose coloured arc shows how much
 *   of the cluster is the dominant category, and a small icon badge for that category;
 * - selected: a dark pill badge that stretches to fit the place name and count.
 */

type IconNode = [string, Record<string, string>][];
const PR = 2; // pixel ratio of the artwork

/** Lucide components wrap their SVG node list; read it so icons can be drawn on a canvas. */
function iconNode(icon: LucideIcon): IconNode {
  try {
    const el = (icon as unknown as { render: (p: object, r: null) => { props?: { iconNode?: IconNode } } }).render({}, null);
    if (Array.isArray(el?.props?.iconNode)) return el.props.iconNode;
  } catch {
    // fall through to a plain dot
  }
  return [["circle", { cx: "12", cy: "12", r: "4" }]];
}

export function groupIcon(group: string): LucideIcon {
  return ICONS[getCategory(group)?.icon ?? "circle-dot"] ?? (CircleDot as LucideIcon);
}

/** Draw a 24×24 Lucide icon centred at (cx, cy), `size` px wide, as strokes. */
function drawIcon(g: CanvasRenderingContext2D, node: IconNode, cx: number, cy: number, size: number, color: string, stroke = 2.25) {
  g.save();
  g.translate(cx - size / 2, cy - size / 2);
  g.scale(size / 24, size / 24);
  g.strokeStyle = color;
  g.lineWidth = stroke;
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const [tag, a] of node) {
    const n = (k: string) => Number(a[k] ?? 0);
    const p = new Path2D();
    if (tag === "path") p.addPath(new Path2D(a.d));
    else if (tag === "circle") p.arc(n("cx"), n("cy"), n("r"), 0, Math.PI * 2);
    else if (tag === "ellipse") p.ellipse(n("cx"), n("cy"), n("rx"), n("ry"), 0, 0, Math.PI * 2);
    else if (tag === "line") {
      p.moveTo(n("x1"), n("y1"));
      p.lineTo(n("x2"), n("y2"));
    } else if (tag === "rect") p.roundRect(n("x"), n("y"), n("width"), n("height"), n("rx"));
    else if (tag === "polyline" || tag === "polygon") {
      const pts = (a.points ?? "").trim().split(/[\s,]+/).map(Number);
      for (let i = 0; i + 1 < pts.length; i += 2) (i ? p.lineTo : p.moveTo).call(p, pts[i], pts[i + 1]);
      if (tag === "polygon") p.closePath();
    }
    g.stroke(p);
  }
  g.restore();
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w * PR;
  c.height = h * PR;
  const g = c.getContext("2d")!;
  g.scale(PR, PR);
  return { c, g };
}

const image = (g: CanvasRenderingContext2D, w: number, h: number) => ({ width: w * PR, height: h * PR, data: g.getImageData(0, 0, w * PR, h * PR).data });

/** Mix a hex colour with white (amount 0–1). */
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * amount);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function rimmedDisc(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  g.save();
  g.shadowColor = "rgba(13,27,51,0.30)";
  g.shadowBlur = 7;
  g.shadowOffsetY = 2;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = "rgba(255,255,255,0.97)";
  g.fill();
  g.restore();
  g.beginPath();
  g.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
  g.strokeStyle = "rgba(13,27,51,0.08)";
  g.lineWidth = 1;
  g.stroke();
}

function colourDisc(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, hex: string) {
  const grad = g.createLinearGradient(cx, cy - r, cx, cy + r);
  grad.addColorStop(0, tint(hex, 0.22));
  grad.addColorStop(1, hex);
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = grad;
  g.fill();
}

export const SINGLE_SIZE = 40;
/** One event: white rim, category-colour disc, white icon. 40×40 px with room for the shadow. */
export function singleMarker(group: string) {
  const hex = GROUP_HEX[group] ?? GROUP_HEX.other;
  const S = SINGLE_SIZE;
  const { g } = canvas(S, S);
  rimmedDisc(g, S / 2, S / 2, 14);
  colourDisc(g, S / 2, S / 2, 11.5, hex);
  drawIcon(g, iconNode(groupIcon(group)), S / 2, S / 2, 13, "#FFFFFF", 2.4);
  return image(g, S, S);
}

export const CLUSTER_SIZE = 52;
export const SHARE_BUCKETS = [25, 50, 75, 100];
/** Several events: count disc, share ring for the dominant category, icon badge. */
export function clusterMarker(group: string, sharePct: number) {
  const hex = GROUP_HEX[group] ?? GROUP_HEX.other;
  const S = CLUSTER_SIZE;
  const c = S / 2 + 2;
  const { g } = canvas(S, S);
  rimmedDisc(g, S / 2, c, 18);
  // Ring: neutral track, then the dominant category's share from 12 o'clock.
  g.lineWidth = 3;
  g.lineCap = "round";
  g.beginPath();
  g.arc(S / 2, c, 14.5, 0, Math.PI * 2);
  g.strokeStyle = "#E3E9F1";
  g.stroke();
  g.beginPath();
  const start = -Math.PI / 2;
  g.arc(S / 2, c, 14.5, start, start + (Math.PI * 2 * Math.min(sharePct, 99.9)) / 100);
  g.strokeStyle = hex;
  g.stroke();
  // Icon badge at the top right.
  const bx = S / 2 + 13;
  const by = c - 13;
  g.save();
  g.shadowColor = "rgba(13,27,51,0.25)";
  g.shadowBlur = 3;
  g.beginPath();
  g.arc(bx, by, 7.5, 0, Math.PI * 2);
  g.fillStyle = "#FFFFFF";
  g.fill();
  g.restore();
  colourDisc(g, bx, by, 6.25, hex);
  drawIcon(g, iconNode(groupIcon(group)), bx, by, 8, "#FFFFFF", 2.6);
  return image(g, S, S);
}

/** Share of a cluster that is its dominant category, snapped to the drawn buckets. */
export function shareBucket(count: number, dominantCount: number): number {
  const pct = count ? (dominantCount / count) * 100 : 100;
  return SHARE_BUCKETS.find((b) => pct <= b + 12.5) ?? 100;
}

/** Stretchable dark pill for the selected marker's name badge. */
export function badgeImage() {
  const W = 40;
  const H = 30;
  const { g } = canvas(W, H);
  g.save();
  g.shadowColor = "rgba(13,27,51,0.35)";
  g.shadowBlur = 6;
  g.shadowOffsetY = 2;
  g.beginPath();
  g.roundRect(3, 2, W - 6, H - 7, (H - 7) / 2);
  g.fillStyle = "#0D1B33";
  g.fill();
  g.restore();
  return {
    image: image(g, W, H),
    options: {
      pixelRatio: PR,
      stretchX: [[16 * PR, 24 * PR]] as [number, number][],
      stretchY: [[12 * PR, 14 * PR]] as [number, number][],
      content: [13 * PR, 4 * PR, 27 * PR, 22 * PR] as [number, number, number, number],
    },
  };
}
