import { NextRequest } from "next/server";
import { z } from "zod";
import { ensureFresh, suggestEntities, cityStats } from "@/lib/store";
import { ALL_DESTINATIONS } from "@/lib/destinations";
import { CATEGORIES } from "@/lib/categories";
import { handler, ok, validationError } from "@/lib/api";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

export const dynamic = "force-dynamic";
const schema = z.object({ q: z.string().max(100) });
const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** GET /api/search/suggest?q=… — autocomplete across destinations, categories, people, venues and events. */
export const GET = handler(async (req: NextRequest) => {
  const p = schema.safeParse({ q: req.nextUrl.searchParams.get("q") ?? "" });
  if (!p.success) return validationError(p.error);
  const q = norm(p.data.q.trim());
  await ensureFresh();
  if (q.length < 2) return ok({ destinations: [], categories: [], participants: [], venues: [], events: [] });
  const stats = cityStats();
  const last = q.split(" ").pop()!;
  const match = (names: string[]) =>
    names.some((n) => {
      const x = norm(n);
      return x.startsWith(q) || x.includes(` ${q}`) || (last.length >= 3 && x.startsWith(last));
    });
  const destinations = ALL_DESTINATIONS.filter((d) => match([d.name, ...(d.aliases ?? [])]))
    .sort((a, b) => (stats[b.id]?.total ?? 0) - (stats[a.id]?.total ?? 0))
    .slice(0, 5)
    .map((d) => ({ id: d.id, slug: d.slug, name: d.name, kind: d.kind, country: d.country, lat: d.lat, lng: d.lng, events: stats[d.id]?.total }));
  const categories = CATEGORIES.filter((c) => match([c.name, ...(c.keywords ?? [])]))
    .slice(0, 5)
    .map((c) => ({ slug: c.slug, name: c.name, parent: c.parent }));
  return ok({ destinations, categories, ...suggestEntities(p.data.q, 5) }, { maxAge: 30 });
});
