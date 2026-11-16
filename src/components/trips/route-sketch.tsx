import { codeOf, stopColor, type TripStop } from "@/lib/trip";

/*
 * A trip's route drawn small, without a map: its cities where they are, joined by arcs that draw
 * themselves in. Light enough for every card on the trips page.
 */

const W = 160;
const H = 104;
const PAD = 18;

export function RouteSketch({ stops, className = "" }: { stops: Pick<TripStop, "name" | "lat" | "lng">[]; className?: string }) {
  if (!stops.length) return null;
  // Flat projection, squeezed east–west by the latitude so shapes look right.
  const lat0 = stops.reduce((n, s) => n + s.lat, 0) / stops.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = stops.map((s) => s.lng * k);
  const ys = stops.map((s) => -s.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, (y1 - y0) * ((W - 2 * PAD) / (H - 2 * PAD)), 0.05);
  const scale = (W - 2 * PAD) / span;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const pts = stops.map((_, i) => ({ x: W / 2 + (xs[i] - cx) * scale, y: H / 2 + (ys[i] - cy) * scale }));
  // Each leg bends a little to one side, like a flight path.
  const arcs = pts.slice(1).map((b, i) => {
    const a = pts[i];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const bend = 0.22;
    return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${(mx - dy * bend).toFixed(1)} ${(my + dx * bend).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  });
  const many = stops.length > 5;
  // Each name where it fits: above its dot, beside it, or below, never over another name or dot.
  type Spot = { x: number; y: number; anchor: "start" | "middle" | "end" };
  const LW = 17;
  const LH = 8;
  const boxOf = (l: Spot) => {
    const left = l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - LW : l.x - LW / 2;
    return { l: left, r: left + LW, t: l.y - LH + 1, b: l.y + 1 };
  };
  const hits = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const placed: ReturnType<typeof boxOf>[] = [];
  const dots = pts.map((p) => ({ l: p.x - 5, r: p.x + 5, t: p.y - 5, b: p.y + 5 }));
  const labels: (Spot | null)[] = many
    ? pts.map(() => null)
    : pts.map((p) => {
        const options: Spot[] = [
          { x: p.x, y: p.y - 9, anchor: "middle" },
          { x: p.x + 9, y: p.y + 3, anchor: "start" },
          { x: p.x - 9, y: p.y + 3, anchor: "end" },
          { x: p.x, y: p.y + 15, anchor: "middle" },
        ];
        const fits = (o: Spot) => {
          const b = boxOf(o);
          return b.l >= 0 && b.r <= W && b.t >= 0 && b.b <= H && !placed.some((x) => hits(x, b)) && !dots.some((d) => hits(d, b));
        };
        const pick = options.find(fits);
        if (!pick) return null;
        placed.push(boxOf(pick));
        return pick;
      });
  return (
    <svg className={`route-sketch ${className}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Route: ${stops.map((s) => s.name).join(" to ")}`}>
      {arcs.map((d, i) => (
        <path key={i} d={d} className="route-sketch-arc" style={{ "--i": i } as React.CSSProperties} pathLength={1} />
      ))}
      {pts.map((p, i) => (
        <g key={i} className="route-sketch-stop" style={{ "--i": i } as React.CSSProperties}>
          {i === 0 && <circle cx={p.x} cy={p.y} r="9" className="route-sketch-pulse" style={{ fill: stopColor(0) }} />}
          <circle cx={p.x} cy={p.y} r={many ? 4 : 5.5} style={{ fill: stopColor(i) }} className="route-sketch-dot" />
          {labels[i] && (
            <text x={labels[i]!.x} y={labels[i]!.y} textAnchor={labels[i]!.anchor} className="route-sketch-code">
              {codeOf(stops[i].name)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
