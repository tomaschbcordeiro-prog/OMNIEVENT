import { NextResponse, type NextRequest } from "next/server";
import { pageCsp } from "@/lib/csp";

/**
 * Every page gets its own Content-Security-Policy with a fresh random nonce: only the scripts
 * this site writes into the page (each carrying that nonce), and the ones they load, may run.
 * A script slipped into a page by anyone else (a crafted link, a post, an event description)
 * has no nonce and is refused by the browser, so it can't read a member's sign-in or act for them.
 *
 * Next.js reads the nonce from the request's policy and puts it on its own scripts; the root
 * layout reads it from `x-nonce` for the theme script.
 */
export function middleware(req: NextRequest) {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const nonce = btoa(String.fromCharCode(...bytes));
  const policy = pageCsp(nonce, process.env.NODE_ENV !== "production");

  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", policy);
  return res;
}

export const config = {
  matcher: [
    {
      // Pages only: not the API (its own strict policy is set in next.config.ts), Next's
      // built files, or the static files in public/.
      source: "/((?!api/|_next/static|_next/image|maplibre/|fonts/|textures/|sw\\.js|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|webp|avif|ico|woff2?|mjs|js|css|json|txt|xml)$).*)",
      // Prefetches carry no HTML to protect.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
