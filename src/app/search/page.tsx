import { redirect } from "next/navigation";
import { parseQuery } from "@/lib/search/parse";
import { filtersToParams } from "@/lib/search/params";

/** /search?q=… parses natural language server-side and lands on the shareable /events URL. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  if (!q?.trim()) redirect("/events");
  const p = filtersToParams(parseQuery(q.slice(0, 200)).filters);
  p.set("asked", q.slice(0, 200));
  redirect(`/events?${p}`);
}
