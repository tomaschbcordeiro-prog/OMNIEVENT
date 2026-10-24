import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { Header } from "@/components/header";

// Background data syncs keep running after the response, up to this many seconds.
export const maxDuration = 300;

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "OMNIEVENT: discover events anywhere on Earth", template: "%s | OMNIEVENT" },
  description:
    "Explore concerts, sport, theatre, festivals, conferences, exhibitions and attractions on an interactive 3D globe, compare ticket options and go straight to official sellers.",
  openGraph: { type: "website", siteName: "OMNIEVENT" },
  twitter: { card: "summary_large_image" },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#3F97F2", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="min-h-dvh">
        <Header />
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
