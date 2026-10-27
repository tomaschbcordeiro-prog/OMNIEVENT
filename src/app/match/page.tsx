import type { Metadata } from "next";
import { MatchDeck } from "@/components/match/match-deck";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Event Match: swipe your next plan",
  description: "One event at a time: swipe right to save it, left to pass. Tonight, this weekend or this month, near you or anywhere.",
  alternates: { canonical: "/match" },
};

export default function MatchPage() {
  return (
    <>
      <main>
        <MatchDeck />
      </main>
      <Footer />
    </>
  );
}
