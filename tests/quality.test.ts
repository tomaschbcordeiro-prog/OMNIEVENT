import { describe, expect, it } from "vitest";
import { dullness, isDull, isShouting } from "@/lib/quality";

const card = (title: string, venueName = "Somewhere", groupSlug = "music", imageUrl?: string) => ({ title, venueName, categorySlug: groupSlug, groupSlug, imageUrl });

describe("listings few go out for", () => {
  it("knows administrative, school and job business", () => {
    expect(isDull(card("VOS ALLOCATIONS: 3 erreurs à éviter", "Agence LA SEYNE SUR MER", "culture"))).toBe(true);
    expect(isDull(card("IE Brown Executive MBA | Executive Open", "IE Tower", "education", "x.jpg"))).toBe(true);
    expect(isDull(card("Visite SAVCO - Collège Condorcet Nailloux 1", "savco", "culture"))).toBe(true);
    expect(isDull(card("INTERVENTION AJE", "lycée polyvalent galilée", "culture"))).toBe(true);
    expect(isDull(card("Réunion d'information inscriptions 2027", "Mairie", "education"))).toBe(true);
    expect(isDull(card("Job dating restauration", "Pôle emploi", "other"))).toBe(true);
  });
  it("leaves outings alone", () => {
    for (const t of ["Caminhos Juniores", "Coldplay: Music of the Spheres", "Benfica vs Porto", "Hamlet", "Jazz no Parque", "Festa do Avante!", "Pasodobles, música española y marchas", "Exposição: Amadeo de Souza-Cardoso", "Open-air cinema: Amélie"]) {
      expect(isDull(card(t, "Teatro Nacional", "theatre", "x.jpg"))).toBe(false);
    }
    // Capitals alone (a band's name, an acronym) don't make it dull.
    expect(isDull(card("ACDC TRIBUTE NIGHT LIVE", "Coliseu", "music", "x.jpg"))).toBe(false);
    expect(dullness(card("ACDC TRIBUTE NIGHT LIVE", "Coliseu", "music", "x.jpg"))).toBe(1);
  });
  it("tells shouting from acronyms", () => {
    expect(isShouting("FORINDUSTRIE, L'UNIVERS EXTRAORDINAIRE")).toBe(true);
    expect(isShouting("NOS Alive 2027")).toBe(false);
    expect(isShouting("U2")).toBe(false);
  });
});

describe("company and industry days", () => {
  it("are dull too", () => {
    expect(isDull(card("Semaine de l'industrie chez VINCI Energies Océan Indien", "VINCI – Sainte-Clotilde", "food-drink"))).toBe(true);
  });
  it("job fairs and job-centre contact points come after the outings", () => {
    expect(isDull({ title: "Opération Pyrénées : façonnez votre avenir", venueName: "Tarbes", categorySlug: "career-fairs", groupSlug: "conferences", imageUrl: "x" })).toBe(true);
    expect(isDull({ title: "point contact Verchocq", venueName: "Verchocq - Agence MARCONNELLE", categorySlug: "culture", groupSlug: "culture", imageUrl: "x" })).toBe(true);
    expect(isDull({ title: "Concert de l'harmonie", venueName: "Salle des fêtes", categorySlug: "concerts", groupSlug: "music", imageUrl: "x" })).toBe(false);
  });
});
