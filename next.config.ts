import type { NextConfig } from "next";

/**
 * Security headers for every response.
 * - CSP: scripts and styles only from this site (Next's inline bootstrap needs 'unsafe-inline');
 *   pictures from any https source (event images come from hundreds of sites); map tiles and
 *   fonts from the tile servers; MapLibre's workers run from blob: URLs. No plugins, no
 *   framing by other sites.
 * - The rest: no MIME sniffing, no framing, a short referrer to other sites, and no access
 *   to camera, microphone or payment APIs (location only for "near me", on this site).
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://tiles.openfreemap.org https://api.maptiler.com https://tiles.maps.eox.at https://s3.amazonaws.com",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
