import { THEME_BOOT } from "@/lib/theme-boot";
import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import localFont from "next/font/local";
import "./globals.css";
import { Header } from "@/components/header";
import { JoinHost } from "@/components/community/bits";
import { Shortcuts } from "@/components/shortcuts";
import { TiltCards } from "@/components/tilt-cards";
import { Toaster } from "@/components/toast";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { AppShell } from "@/components/app-shell";
import { HoverGlide } from "@/components/hover-glide";
import { NetworkStatus } from "@/components/network-status";
import { SITE } from "@/lib/site";
import { Suspense } from "react";
import { headers } from "next/headers";
import { NavProgress } from "@/components/nav-progress";
import { IntentPrefetch } from "@/components/intent-prefetch";
import { TrailRecorder } from "@/components/event-trail";
import { AfterEventNudge } from "@/components/how-was-it";
import { TripDock } from "@/components/trips/trip-add";
import { CommandMenu } from "@/components/command-menu";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

/**
 * Figtree (SIL Open Font License, see src/fonts): the site's typeface, headlines and text alike.
 * A friendly geometric sans in the family of the much-loved brand faces (Airbnb's Cereal,
 * Spotify's Circular), as one variable font for every weight, upright and italic.
 */
const figtree = localFont({
  src: [
    { path: "../fonts/figtree-latin-normal.woff2", weight: "300 900", style: "normal" },
    { path: "../fonts/figtree-latin-italic.woff2", weight: "300 900", style: "italic" },
  ],
  variable: "--font-figtree",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});
/** Its extended Latin letters (ł, č, ş…), fetched only when a page uses them. */
const figtreeExt = localFont({
  src: [{ path: "../fonts/figtree-latin-ext-normal.woff2", weight: "300 900", style: "normal" }],
  variable: "--font-figtree-ext",
  display: "swap",
  preload: false,
});


export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Mundivi: discover events anywhere on Earth", template: "%s | Mundivi" },
  description:
    "Explore concerts, sport, theatre, festivals, conferences, exhibitions and attractions on an interactive 3D globe, compare ticket options and go straight to official sellers.",
  openGraph: { type: "website", siteName: "Mundivi" },
  twitter: { card: "summary_large_image" },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Mundivi", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e8eef8" },
    { media: "(prefers-color-scheme: dark)", color: "#070b16" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The keyboard makes the page shorter (Android), so what's typed into stays in view.
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The page's own script nonce (src/middleware.ts): only scripts carrying it may run. Reading
  // it renders each page for its request, so every page gets a fresh one.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // data-theme is set by the script below before React starts, hence the warning switched off.
    <html lang="en" className={`${GeistSans.variable} ${figtree.variable} ${figtreeExt.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-dvh">
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <Header />
        <div id="main">{children}</div>
        <JoinHost />
        <Shortcuts />
        <CommandMenu />
        <TiltCards />
        <Toaster />
        <MobileTabBar />
        <AppShell />
        <NetworkStatus />
        <IntentPrefetch />
        <TrailRecorder />
        <AfterEventNudge />
        <TripDock />
        <HoverGlide />
      </body>
    </html>
  );
}
