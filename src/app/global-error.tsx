"use client";

/** Last-resort boundary: catches errors in the root layout so visitors never see a blank page. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#F3F7FC", color: "#0D1B33", fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "96px 16px" }}>
          <h1 style={{ fontSize: 32, letterSpacing: "-0.02em", margin: 0 }}>OMNIEVENT hit a problem</h1>
          <p style={{ color: "#46597A", lineHeight: 1.6 }}>Something went wrong in your browser while showing the site. Your saved events are safe.</p>
          <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
            <button onClick={reset} style={{ background: "#1463FF", color: "#FFFFFF", border: 0, borderRadius: 6, padding: "10px 16px", fontWeight: 600, cursor: "pointer" }}>Try again</button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/?view=map" style={{ color: "#0D1B33", border: "1px solid #C9D6E4", borderRadius: 6, padding: "10px 16px", textDecoration: "none" }}>Open the 2D map</a>
          </div>
          <p style={{ color: "#6F819C", fontSize: 12, marginTop: 32 }}>Technical details: {error.message || "unknown error"}{error.digest ? ` (${error.digest})` : ""}</p>
        </main>
      </body>
    </html>
  );
}
