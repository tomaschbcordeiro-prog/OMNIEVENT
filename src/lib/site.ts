/**
 * The site's own address, for canonical links, the sitemap and link previews:
 * NEXT_PUBLIC_SITE_URL when set, else the production address Vercel provides, else local.
 */
export const SITE = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
).replace(/\/+$/, "");
