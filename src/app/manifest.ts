import type { MetadataRoute } from "next";

/** Lets visitors add the site to their home screen and open it like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mundivi: events anywhere on Earth",
    short_name: "Mundivi",
    description: "Concerts, sport, theatre, festivals and more on an interactive globe, near you or anywhere you go.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0A33B8",
    theme_color: "#1463FF",
    categories: ["entertainment", "travel", "lifestyle"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "What's on near me", url: "/events" },
      { name: "Plan a weekend", short_name: "Mixtape", url: "/mixtape" },
      { name: "Night Flight", url: "/?flight=1" },
      { name: "My World", url: "/my-world" },
    ],
  };
}
