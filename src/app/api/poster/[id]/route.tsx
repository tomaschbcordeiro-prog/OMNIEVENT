import { ImageResponse } from "next/og";
import { ensureFresh, getEventView, refreshSource } from "@/lib/store";
import { getCategory } from "@/lib/categories";
import { formatMoney } from "@/lib/format";
import { PosterArt, POSTER_H, POSTER_W, isPosterStyle, type PosterData } from "@/lib/studio/poster";
import { loadOgFonts } from "@/lib/og-fonts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/poster/<id>?s=<style>&v=<version> — a member-listed event's Studio poster, as a
 * 1200×675 image (cards, the event page, link previews). The version changes with each edit,
 * so each one is cached for good.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^ue[a-z0-9]{8}$/.test(id)) return new Response("Not found", { status: 404 });
  const style = new URL(req.url).searchParams.get("s");
  await ensureFresh();
  let e = getEventView(`members-${id}`);
  if (!e) {
    await refreshSource("members").catch(() => {});
    e = getEventView(`members-${id}`);
  }
  if (!e) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const local = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: e.timeZone, ...opts }).format(new Date(e.start));
  const tickets = e.offers.filter((o) => o.basePrice != null);
  const price =
    e.status === "cancelled"
      ? "CANCELLED"
      : e.isFree
        ? e.registrationRequired
          ? "FREE · SIGN UP"
          : "FREE"
        : tickets.length
          ? `${tickets.length > 1 ? "FROM " : ""}${formatMoney(Math.min(...tickets.map((o) => o.basePrice!)), tickets[0].currency)}`
          : undefined;
  const data: PosterData = {
    title: e.title,
    tagline: e.tagline,
    date: local({ weekday: "short", day: "numeric", month: "short" }).replace(",", "").toUpperCase(),
    time: local({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    venue: e.venue.name,
    city: e.venue.city,
    price,
    category: getCategory(e.categorySlug)?.name,
    hue: e.posterHue ?? 265,
  };
  const loaded = await loadOgFonts();
  return new ImageResponse(<PosterArt data={data} styleId={isPosterStyle(style) ? style : "bold"} font={loaded.length ? "Geist" : "sans-serif"} />, {
    width: POSTER_W,
    height: POSTER_H,
    fonts: loaded.length ? loaded : undefined,
    headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" },
  });
}
