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
  // Names above the dots, or beside them when the route runs north–south.
  const tall = y1 - y0 > x1 - x0;
  const label = (p: { x: number; y: number }) =>
    !tall ? { x: p.x, y: p.y - 9, anchor: "middle" as const } : p.x <= W / 2 + 6 ? { x: p.x + 9, y: p.y + 3, anchor: "start" as const } : { x: p.x - 9, y: p.y + 3, anchor: "end" as const };
  return (
    <svg className={`route-sketch ${className}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Route: ${stops.map((s) => s.name).join(" to ")}`}>
      {arcs.map((d, i) => (
        <path key={i} d={d} className="route-sketch-arc" style={{ "--i": i } as React.CSSProperties} pathLength={1} />
      ))}
      {pts.map((p, i) => (
        <g key={i} className="route-sketch-stop" style={{ "--i": i } as React.CSSProperties}>
          {i === 0 && <circle cx={p.x} cy={p.y} r="9" className="route-sketch-pulse" style={{ fill: stopColor(0) }} />}
          <circle cx={p.x} cy={p.y} r={many ? 4 : 5.5} style={{ fill: stopColor(i) }} className="route-sketch-dot" />
          {!many && (
            <text {...(({ anchor, ...xy }) => ({ ...xy, textAnchor: anchor }))(label(p))} className="route-sketch-code">
              {codeOf(stops[i].name)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
