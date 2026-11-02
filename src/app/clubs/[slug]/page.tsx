import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { ClubView } from "@/components/clubs/club-view";
import { getClub } from "@/lib/community/clubs";

export const dynamic = "force-dynamic";
type P = Promise<{ slug: string }>;

const clean = (s: string) => decodeURIComponent(s).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const slug = clean((await params).slug);
  // A link shared in a chat shows the club's name; if storage is away, a plain title.
  const page = await getClub(slug).catch(() => undefined);
  if (!page) return { title: "Club" };
  const { club } = page;
  return {
    title: `${club.emoji} ${club.name}`,
    description: `${club.tagline} · ${club.members} ${club.members === 1 ? "member" : "members"} on OMNIEVENT Clubs.`,
    alternates: { canonical: `/clubs/${club.slug}` },
    robots: club.privacy === "request" ? { index: false, follow: true } : undefined,
  };
}

export default async function ClubPage({ params }: { params: P }) {
  const slug = clean((await params).slug);
  return (
    <>
      <ClubView slug={slug} />
      <Footer />
    </>
  );
}
