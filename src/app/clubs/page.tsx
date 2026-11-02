import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { ClubsHome } from "@/components/clubs/clubs-home";

export const metadata: Metadata = {
  title: "Clubs: find your people, go together",
  description: "Clubs are circles of people who love the same things. Found one, invite friends, share events and vote on what to see together.",
  alternates: { canonical: "/clubs" },
};

export default function ClubsPage() {
  return (
    <>
      <ClubsHome />
      <Footer />
    </>
  );
}
