import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Footer } from "@/components/footer";
import { ClubForm } from "@/components/clubs/club-form";

export const metadata: Metadata = { title: "Found a club", robots: { index: false, follow: true } };

export default function NewClubPage() {
  return (
    <>
      <main id="main">
        <section className="club-hero">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-10">
            <Link href="/clubs" className="t-small text-white/80 hover:text-white">✦ Clubs</Link>
            <h1 className="t-h1 !text-white mt-3">Found a <span className="gold-text">club</span></h1>
            <p className="t-lede text-white/85 mt-2 measure">Give it a name, a crest and a vibe. You&apos;ll be its owner: you choose who joins and who helps you run it.</p>
          </div>
        </section>
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-8">
          <Suspense fallback={<div className="skeleton h-96" aria-hidden />}>
            <ClubForm />
          </Suspense>
        </div>
      </main>
      <Footer />
    </>
  );
}
