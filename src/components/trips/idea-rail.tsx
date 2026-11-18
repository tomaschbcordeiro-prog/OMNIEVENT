import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { IdeaCardData } from "@/lib/travel/idea-cards";
import { RouteSketch } from "./route-sketch";

/**
 * A few ready-made trips (on a city's or a country's page, or the trips page before the first
 * trip): the route drawn small, the stops and nights, and one tap to make it yours.
 */
export function IdeaRail({ cards, title, moreHref, moreLabel }: { cards: IdeaCardData[]; title: string; moreHref: string; moreLabel: string }) {
  if (!cards.length) return null;
  return (
    <section className="mt-12" aria-labelledby="idea-rail-h">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="idea-rail-h" className="t-h2">{title}</h2>
        <Link href={moreHref} className="t-small font-semibold text-cyan hover:underline">{moreLabel} →</Link>
      </div>
      <ul className="ideas-grid !mt-4">
        {cards.map((i, n) => (
          <li key={i.key} className="idea-card" style={{ "--h": i.hue, "--i": n } as React.CSSProperties}>
            <Link href={i.href} className="idea-top" aria-label={`Plan this trip: ${i.title}`}>
              <RouteSketch stops={i.stops} />
              {i.theme && <span className="idea-theme">{i.theme.emoji} {i.theme.label}</span>}
            </Link>
            <div className="idea-body">
              <h3 className="idea-title"><span aria-hidden>{i.emoji}</span> {i.title}</h3>
              <p className="idea-route">
                {i.stops.map((s, k) => (
                  <span key={`${s.name}-${k}`}>
                    {k > 0 && <span className="text-text-3" aria-hidden> → </span>}
                    {s.name} <span className="text-text-3 tnum">{s.nights}n</span>
                  </span>
                ))}
              </p>
              <p className="t-micro text-text-2 mt-2 tnum">
                {i.nights} {i.nights === 1 ? "night" : "nights"}
                {i.stops.length > 1 && <> · {i.km.toLocaleString("en-GB")} km</>} · <span aria-hidden>{i.flags}</span>
                <span className="sr-only">{i.countries}</span>
              </p>
              <div className="idea-actions">
                <Link href={i.href} className="btn btn-primary btn-sm press">Plan this trip <ArrowRight size={14} aria-hidden /></Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
