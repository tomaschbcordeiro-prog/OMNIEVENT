import type { NextConfig } from "next";

import { API_CSP } from "./src/lib/csp";

/**
 * Security headers for every response. Pages also get their own Content-Security-Policy, with
 * a fresh nonce each time (src/middleware.ts, src/lib/csp.ts); API answers and files get one
 * where nothing may run.
 * - HTTPS only, for two years, on this domain and below it (HSTS).
 * - No MIME sniffing, no framing by other sites, a short referrer to other sites, its own
 *   browsing context group (no window.opener tricks), and no access to the camera,
 *   microphone, payments, USB and the like (location only for "near me", on this site).
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), midi=(), display-capture=(), browsing-topics=(), geolocation=(self)",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // A page seen in the last 30 seconds opens again straight from memory (going back to a list
  // from an event, flicking between tabs); after that it's fetched fresh.
  experimental: { staleTimes: { dynamic: 30 } },
  // The Studio's poster images are drawn with the site's typeface, read from disk.
  outputFileTracingIncludes: { "/api/poster/[id]": ["./public/fonts/**"], "/api/mixtape/card": ["./public/fonts/**"], "/api/events/[slug]/card": ["./public/fonts/**"], "/api/img": ["./node_modules/sharp/**", "./node_modules/@img/colour/**", "./node_modules/@img/sharp-linux-x64/**", "./node_modules/@img/sharp-libvips-linux-x64/**"] },
  // Listing an event moved into the Studio; old links keep working (query strings carry over).
  async redirects() {
    return [
      { source: "/events/new", destination: "/studio/new", permanent: false },
      // A venue's or performer's address with its name taken off: where to find them instead.
      { source: "/venues", destination: "/destinations", permanent: false },
      { source: "/participants", destination: "/search", permanent: false },
    ];
  },
  async headers() {
    // Files whose name or address changes with their content can be kept by browsers for good.
    const forever = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CSP }] },
      { source: "/maplibre/:path*", headers: forever },
      { source: "/fonts/:path*", headers: forever },
    ];
  },
};

export default nextConfig;
