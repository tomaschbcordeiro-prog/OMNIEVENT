"use client";

import { useMemo } from "react";
import { Moon, Share2, Sun, Sunrise } from "lucide-react";
import { useUserSelect } from "@/lib/user/store";
import { recapText, recapWorthShowing, yearRecap } from "@/lib/recap";
import { flagOf } from "@/lib/trip";
import { CategoryIcon } from "../ui";
import { toast } from "../toast";

/*
 * Your year, in a few cards: what you saved, the kinds you love, the day of the week your events
 * fall on, whether you're out at night, and the trips you planned. Worked out in this browser
 * from your own lists; shown once there's enough to say something true.
 */

const SHORT = ["M", "T", "W", "T", "F", "S", "S"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function YearRecap() {
  const saved = useUserSelect((d) => d.saved);
  const trips = useUserSelect((d) => d.trips);
  const r = useMemo(() => yearRecap({ saved, trips }), [saved, trips]);
  if (!recapWorthShowing(r)) return null;
  const share = async () => {
    const text = recapText(r);
    try {
      if (navigator.share) await navigator.share({ text, url: window.location.origin });
      else {
        await navigator.clipboard.writeText(`${text} ${window.location.origin}`);
        toast({ title: "Copied", body: "Paste it wherever you like.", emoji: "📋" });
      }
    } catch {
      // the share sheet was closed
    }
  };
  const maxDay = Math.max(1, ...r.weekdays);
  return (
    <section aria-labelledby="recap-h" className="recap">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="t-micro font-semibold uppercase tracking-[0.14em] text-text-3">Your year</p>
          <h2 id="recap-h" className="t-h2 mt-0.5">{r.year} on Mundivi</h2>
        </div>
        <button type="button" className="btn btn-secondary btn-sm press" onClick={() => void share()}>
          <Share2 size={14} aria-hidden /> Share
        </button>
      </div>
      <ul className="recap-cards" tabIndex={0} aria-label={`Your ${r.year} in cards`}>
        {r.saved > 0 && (
          <li className="recap-card">
            <p className="recap-k">Saved</p>
            <p className="recap-n tnum">{r.saved}</p>
            <p className="recap-s">{r.saved === 1 ? "event" : "events"} this year{r.ahead ? `, ${r.ahead} still to come` : ""}</p>
          </li>
        )}
        {r.kinds.length > 0 && (
          <li className="recap-card">
            <p className="recap-k">Mostly</p>
            <p className="recap-t flex items-center gap-2">
              <CategoryIcon slug={r.kinds[0].group} size={22} className="text-white/80" /> {r.kinds[0].name}
            </p>
            <ul className="mt-3 grid gap-1.5" aria-label="Your top kinds">
              {r.kinds.map((k) => (
                <li key={k.group} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 t-micro text-white/75">
                  <span className="truncate">{k.name}</span>
                  <span className="tnum">{Math.round(k.share * 100)}%</span>
                  <span className="recap-bar col-span-2" aria-hidden>
                    <span style={{ width: `${Math.max(6, k.share * 100)}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          </li>
        )}
        {r.topDay && (
          <li className="recap-card">
            <p className="recap-k">Your day</p>
            <p className="recap-t">A {r.topDay} person</p>
            <div className="recap-week" role="img" aria-label={`Events by weekday: ${r.weekdays.map((n, i) => `${DAYS[i]} ${n}`).join(", ")}`}>
              {r.weekdays.map((n, i) => (
                <span key={i} className="recap-week-day">
                  <span className="recap-week-bar" style={{ height: `${Math.max(8, (n / maxDay) * 100)}%` }} data-top={n === maxDay || undefined} />
                  <span aria-hidden>{SHORT[i]}</span>
                </span>
              ))}
            </div>
          </li>
        )}
        {r.dayPart && (
          <li className="recap-card">
            <p className="recap-k">When you go out</p>
            <p className="recap-t flex items-center gap-2">
              {r.dayPart === "night" ? <Moon size={22} aria-hidden className="text-white/80" /> : r.dayPart === "day" ? <Sun size={22} aria-hidden className="text-white/80" /> : <Sunrise size={22} aria-hidden className="text-white/80" />}
              {r.dayPart === "night" ? "Night owl" : r.dayPart === "day" ? "Daytime explorer" : "Any time of day"}
            </p>
            {r.nightShare != null && <p className="recap-s">{Math.round(r.nightShare * 100)}% of your events start after 7&nbsp;pm{r.topMonth ? `. Busiest month: ${r.topMonth}` : ""}.</p>}
          </li>
        )}
        {r.trips > 0 && (
          <li className="recap-card">
            <p className="recap-k">Trips</p>
            <p className="recap-n tnum">{r.trips}</p>
            <p className="recap-s">
              {r.nights ? `${r.nights} nights, ` : ""}
              {r.cities} {r.cities === 1 ? "city" : "cities"}
              {r.countries.length ? ` in ${r.countries.length} ${r.countries.length === 1 ? "country" : "countries"}` : ""}
            </p>
            {r.countries.length > 0 && (
              <p className="mt-2 text-xl leading-none tracking-[0.1em]" aria-label={`Countries: ${r.countries.join(", ")}`}>
                {r.countries.slice(0, 8).map((c) => flagOf(c)).join(" ")}
              </p>
            )}
          </li>
        )}
      </ul>
    </section>
  );
}
