/**
 * The site's own address, for canonical links, the sitemap and link previews:
 * NEXT_PUBLIC_SITE_URL when set, else the production address Vercel provides, else local.
 */
export const SITE = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
).replace(/\/+$/, "");

/**
 * The public address the site's robots give as their contact when they fetch event and place
 * data: the live site's own address (so it follows a new domain by itself), the current public
 * one when running on a computer.
 */
export const CONTACT_URL = SITE.startsWith("http://localhost") ? "https://omnievent.vercel.app" : SITE;
