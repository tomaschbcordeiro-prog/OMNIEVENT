import { NextRequest, NextResponse } from "next/server";
import { ensureFresh, getOffer } from "@/lib/store";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Outbound ticket link. Only redirects to URLs stored on a known offer (no open
 * redirect). This is also where authorised affiliate parameters would be added.
 * Demo offers go to an explanatory page instead of a fake checkout.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await ctx.params;
  await ensureFresh();
  const offer = getOffer(decodeURIComponent(offerId));
  if (!offer) return NextResponse.redirect(new URL("/events?notice=offer-expired", req.url));
  if (offer.isDemo) return NextResponse.redirect(new URL(`/demo-ticket?offer=${encodeURIComponent(offer.id)}`, req.url));
  const url = offer.purchaseUrl;
  if (!url || !/^https:\/\//.test(url)) return NextResponse.redirect(new URL("/events?notice=offer-unavailable", req.url));
  log("info", "outbound ticket click", { offer: offer.id, provider: offer.provider });
  return NextResponse.redirect(url, 302);
}
