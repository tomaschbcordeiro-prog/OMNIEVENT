/**
 * The Content-Security-Policy of the site's pages (set per request by src/middleware.ts).
 *
 * - Scripts: only those carrying this response's nonce, and what they load ('strict-dynamic').
 *   No inline handlers, no javascript: links, no eval (development builds need eval for fast
 *   refresh, so `dev` allows it there only).
 * - Styles: this site, plus inline styles (React's style attributes; they can't run code).
 * - Pictures from any https source (event pictures come from hundreds of sites); map tiles,
 *   satellite imagery and the weather from the services the maps use; MapLibre's workers.
 * - Nothing may frame the site, no plugins, forms only post here, and <base> can't be moved.
 */
export const CONNECT = [
  "https://tiles.openfreemap.org",
  "https://api.maptiler.com",
  "https://tiles.maps.eox.at",
  "https://s3.amazonaws.com",
  "https://gibs.earthdata.nasa.gov",
  "https://api.open-meteo.com",
];

export function pageCsp(nonce: string, dev = false): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${CONNECT.join(" ")}${dev ? " ws:" : ""}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self' https:",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** For everything that isn't a page (API answers, pictures, files): nothing in it may run. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
