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
import { SITE } from "@/lib/site";
import { Suspense } from "react";
import { NavProgress } from "@/components/nav-progress";
import { IntentPrefetch } from "@/components/intent-prefetch";
import { TrailRecorder } from "@/components/event-trail";
import { AfterEventNudge } from "@/components/how-was-it";
import { TripDock } from "@/components/trips/trip-add";
import { CommandMenu } from "@/components/command-menu";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

/** Instrument Serif (SIL Open Font License, see src/fonts): the big headlines. */
const display = localFont({
  src: [
    { path: "../fonts/instrument-serif-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/instrument-serif-latin-400-italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-display",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});


export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "OMNIEVENT: discover events anywhere on Earth", template: "%s | OMNIEVENT" },
  description:
    "Explore concerts, sport, theatre, festivals, conferences, exhibitions and attractions on an interactive 3D globe, compare ticket options and go straight to official sellers.",
  openGraph: { type: "website", siteName: "OMNIEVENT" },
  twitter: { card: "summary_large_image" },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "OMNIEVENT", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#3F97F2" },
    { media: "(prefers-color-scheme: dark)", color: "#0a111e" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The keyboard makes the page shorter (Android), so what's typed into stays in view.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by the script below before React starts, hence the warning switched off.
    <html lang="en" className={`${GeistSans.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
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
        <IntentPrefetch />
        <TrailRecorder />
        <AfterEventNudge />
        <TripDock />
      </body>
    </html>
  );
}
