/*
 * OMNIEVENT on a phone, like an app: pages and data come from the network first (so they are
 * always current), and from the phone when there's no network; the site's own files (scripts,
 * styles, fonts, icons, the globe's pictures) come from the phone once fetched, so coming back
 * is instant. Nothing is stored that isn't needed, and old copies are cleared on each update.
 */
const VERSION = "v2";
const STATIC = `static-${VERSION}`;
const PAGES = `pages-${VERSION}`;
const DATA = `data-${VERSION}`;
const TILES = `tiles-${VERSION}`;
const IMAGES = `images-${VERSION}`;
const KEEP = [STATIC, PAGES, DATA, TILES, IMAGES];
const OFFLINE = "/offline";

/** The offline page, and the files it needs to run (so it works the first time it's needed). */
async function keepOffline() {
  const res = await fetch(new Request(OFFLINE, { cache: "reload" }));
  if (!res.ok) return;
  const html = await res.clone().text();
  await (await caches.open(PAGES)).put(OFFLINE, res);
  const files = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))];
  const c = await caches.open(STATIC);
  await Promise.all(files.map((f) => c.add(f).catch(() => {})));
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    keepOffline()
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Keeps a cache to its newest `max` entries. */
async function trim(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

/**
 * The network, and a copy kept. When the network fails, the copy; when it's only slow, the copy
 * if there is one, else the network still (a slow page beats the offline page).
 */
async function networkFirst(req, name, max, ms) {
  const net = fetch(req).then((res) => {
    if (res.ok && res.type === "basic") {
      const copy = res.clone();
      caches.open(name).then((c) => c.put(req, copy).then(() => trim(name, max)));
    }
    return res;
  });
  net.catch(() => {});
  try {
    return await Promise.race([net, timeout(ms)]);
  } catch {
    const hit = await caches.match(req);
    if (hit) return hit;
    return net;
  }
}

/** The kept copy, or the network (and keep it). */
async function cacheFirst(req, name, max) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Only answers that can be read (not opaque ones, which take far more room than they show).
  if (res.ok && (res.type === "basic" || res.type === "cors")) {
    const copy = res.clone();
    caches.open(name).then((c) => c.put(req, copy).then(() => max && trim(name, max)));
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // The globe's map tiles, heights and fonts: kept, each address never changes.
  if ((url.hostname === "tiles.openfreemap.org" && !url.pathname.endsWith(".json")) || (url.hostname === "s3.amazonaws.com" && url.pathname.startsWith("/elevation-tiles")) || (url.hostname === "api.maptiler.com" && /\/(tiles|fonts)\//.test(url.pathname))) {
    e.respondWith(cacheFirst(req, TILES, 600));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Next.js's own data for moving between pages: always fresh, never kept.
  if (url.searchParams.has("_rsc") || req.headers.get("RSC") === "1" || req.headers.get("Next-Router-Prefetch")) return;

  // Files named by their content: kept for good.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/maplibre/") || url.pathname.startsWith("/textures/") || /^\/(icon|apple-touch-icon)[\w-]*\.(png|svg)$/.test(url.pathname)) {
    e.respondWith(cacheFirst(req, STATIC, 500));
    return;
  }
  // Pictures the site resizes.
  if (url.pathname.startsWith("/_next/image")) {
    e.respondWith(cacheFirst(req, IMAGES, 150));
    return;
  }

  // Pages: the network first; the last copy (or the offline page) without one.
  if (req.mode === "navigate") {
    e.respondWith(
      networkFirst(req, PAGES, 40, 6000).catch(async () => (await caches.match(req)) || (await caches.match(OFFLINE)) || Response.error()),
    );
    return;
  }

  // Lists of events and saved events: the network first, the last answer when offline.
  if (/^\/api\/(events|events\/batch|places\/top|places\/photo|weather)\b/.test(url.pathname)) {
    e.respondWith(networkFirst(req, DATA, 80, 8000));
  }
});

// The page can ask the new version to take over straight away.
self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});
