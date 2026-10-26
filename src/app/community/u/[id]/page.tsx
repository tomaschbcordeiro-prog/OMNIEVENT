import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { MemberPage } from "@/components/community/member-page";

export const dynamic = "force-dynamic";
type P = Promise<{ id: string }>;

export const metadata: Metadata = { title: "Community member", robots: { index: false, follow: true } };

export default async function Member({ params }: { params: P }) {
  const { id } = await params;
  return (
    <>
      <MemberPage id={decodeURIComponent(id).replace(/[^a-z0-9._]/gi, "").slice(0, 20)} />
      <Footer />
    </>
  );
}
