import type { Metadata } from "next";
import { StudioHome } from "@/components/studio/studio-home";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Studio · list your event",
  description: "OMNIEVENT Studio: paste your announcement and it fills itself in, a poster that designs itself, and your event on the globe in a minute. Free.",
};

export default function StudioPage() {
  return (
    <>
      <StudioHome />
      <Footer />
    </>
  );
}
