import type { Metadata } from "next";
import { CreateEvent } from "@/components/create/wizard";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "New event · Studio",
  description: "Put your event on the map: a few short steps, a poster that designs itself, and it appears on the OMNIEVENT globe, in search and on its city's page.",
  robots: { index: false, follow: true },
};

type Q = { edit?: string; template?: string; from?: string; duplicate?: string };
const id = (s?: string) => (s && /^ue[a-z0-9]{8}$/.test(s) ? s : undefined);

export default async function StudioNewPage({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const editId = id(q.edit);
  const duplicateId = id(q.duplicate);
  const template = q.template && /^[a-z-]{2,30}$/.test(q.template) ? q.template : undefined;
  return (
    <>
      <CreateEvent key={editId ?? duplicateId ?? template ?? q.from ?? "new"} editId={editId} template={template} fromPaste={q.from === "paste"} duplicateId={duplicateId} />
      <Footer />
    </>
  );
}
