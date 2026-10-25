import "server-only";
import { getCard, getEventView, getParticipantBySlug, getVenueBySlug } from "../store";
import { getDestination } from "../destinations";
import type { TargetMeta } from "./types";

/** What the community shows about a target, taken from our own data (never from the browser). */
export function resolveTarget(target: string): TargetMeta | undefined {
  const [kind, ...rest] = target.split(":");
  const key = rest.join(":");
  if (kind === "e") {
    const c = getCard(key) ?? (() => {
      const v = getEventView(key);
      return v ? getCard(v.id) : undefined;
    })();
    if (!c) return undefined;
    return { target, title: c.title, href: `/events/${c.slug}`, sub: `${c.venueName}, ${c.city}`, start: c.start, timeZone: c.timeZone, imageUrl: c.imageUrl, hue: c.posterHue, categorySlug: c.categorySlug };
  }
  if (kind === "v") {
    const v = getVenueBySlug(key);
    return v ? { target, title: v.name, href: `/venues/${v.slug}`, sub: [v.city, v.country].filter(Boolean).join(", ") } : undefined;
  }
  if (kind === "p") {
    const p = getParticipantBySlug(key);
    return p ? { target, title: p.name, href: `/participants/${p.slug}`, sub: p.kind === "team" ? "Team" : "Performer", imageUrl: p.imageUrl } : undefined;
  }
  if (kind === "d") {
    const d = getDestination(key);
    return d ? { target, title: d.name, href: `/destinations/${d.slug}`, sub: "City board" } : undefined;
  }
  return undefined;
}
