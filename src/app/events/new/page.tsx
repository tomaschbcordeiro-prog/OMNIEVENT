import type { Metadata } from "next";
import { CreateEvent } from "@/components/create/wizard";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "List your event",
  description: "Put your event on the map: a few short steps and it appears on the OMNIEVENT globe, in search and on its city's page.",
  robots: { index: false, follow: true },
};

export default async function NewEventPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  const editId = edit && /^ue[a-z0-9]{8}$/.test(edit) ? edit : undefined;
  return (
    <>
      <CreateEvent key={editId ?? "new"} editId={editId} />
      <Footer />
    </>
  );
}
