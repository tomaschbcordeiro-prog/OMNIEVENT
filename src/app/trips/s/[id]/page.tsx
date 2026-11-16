import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSharedTrip } from "@/lib/community/shared-trips";
import { flagOf } from "@/lib/trip";
import { countryName } from "@/lib/travel/ideas";
import { Footer } from "@/components/footer";
import { Avatar } from "@/components/community/bits";
import { RouteSketch } from "@/components/trips/route-sketch";
import { SharedTripActions } from "@/components/trips/shared-trips";

export const dynamic = "force-dynamic";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

async function load(id: string) {
  try {
    const t = await getSharedTrip(id);
    return t && !t.hidden ? t : undefined;
  } catch {
    return undefined;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const t = await load((await params).id);
  if (!t) return { title: "Shared trip", robots: { index: false } };
  return {
    title: `${t.name}: a trip by ${t.by?.username ? `@${t.by.username}` : "a traveller"}`,
    description: `${t.stops.map((s) => s.name).join(" → ")}. ${t.nights} nights${t.about ? `. ${t.about.slice(0, 120)}` : ""}`,
    alternates: { canonical: `/trips/s/${t.id}` },
  };
}

export default async function SharedTripPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await load((await params).id);
  if (!t) notFound();
  const countries = [...new Set(t.stops.map((s) => s.cc).filter((c): c is string => !!c))];
  return (
    <>
      <main className="mx-auto max-w-[1000px] px-4 sm:px-6 pt-8 pb-16">
        <p className="t-small font-semibold text-text-2">
          <Link href="/trips" className="hover:underline">Trips</Link> / <Link href="/trips/shared" className="hover:underline">From travellers</Link>
        </p>
        <div className="shared-hero mt-3">
          <div className="min-w-0">
            <h1 className="t-display"><span aria-hidden>{t.emoji}</span> {t.name}</h1>
            <p className="mt-3 flex items-center gap-2 t-small">
              <Avatar p={t.by} size={28} />
              <span>
                By {t.by ? <Link href={`/community/u/${t.by.username ?? t.by.id}`} className="font-semibold hover:underline">{t.by.name}</Link> : "a traveller"}
                {t.month ? <span className="text-text-2"> · went in {MONTHS[t.month - 1]}</span> : null}
              </span>
            </p>
            <p className="mt-3 t-body text-text-2 tnum">
              {t.nights} {t.nights === 1 ? "night" : "nights"} · {t.stops.length} {t.stops.length === 1 ? "city" : "cities"}
              {t.km > 0 && <> · {t.km.toLocaleString("en-GB")} km</>} · {countries.map((c) => `${flagOf(c)} ${countryName(c)}`).join(", ")}
            </p>
            {t.about && <p className="mt-4 t-body whitespace-pre-line measure">{t.about}</p>}
          </div>
          <div className="shared-hero-map">
            <RouteSketch stops={t.stops} />
          </div>
        </div>
        <SharedTripActions trip={t} />
        <h2 className="t-h2 mt-10">The route</h2>
        <ol className="shared-stops mt-4">
          {t.stops.map((s, i) => (
            <li key={`${s.name}${i}`} className="shared-stop">
              <span className="shared-stop-n" aria-hidden>{i + 1}</span>
              <div className="min-w-0">
                <p className="font-semibold">
                  {s.cityId ? <Link href={`/destinations/${s.cityId}`} className="hover:underline">{s.name}</Link> : s.name} {s.cc && <span aria-hidden>{flagOf(s.cc)}</span>}
                  <span className="text-text-2 font-normal tnum"> · {s.nights} {s.nights === 1 ? "night" : "nights"}</span>
                </p>
                {s.see && s.see.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`Worth seeing in ${s.name}`}>
                    {s.see.map((x) => (
                      <li key={x} className="chip">{x}</li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-10 t-small text-text-2">
          Looking for more? <Link href="/trips/ideas" className="font-semibold underline">Endless trip ideas</Link> or <Link href="/trips/shared" className="font-semibold underline">more trips from travellers</Link>.
        </p>
      </main>
      <Footer />
    </>
  );
}
