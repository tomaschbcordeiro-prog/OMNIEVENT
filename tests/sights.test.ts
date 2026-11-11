import { describe, expect, it } from "vitest";
import { sightsFromWikipedia, type WikiPage } from "@/lib/sights";

// Round central Lisbon, as Wikipedia answered.
const page = (pageid: number, title: string, description: string, length: number, img = true): WikiPage => ({ pageid, title, description, length, coordinates: [{ lat: 38.71 + pageid / 1e4, lon: -9.14 }], thumbnail: img ? { source: `https://upload.wikimedia.org/${pageid}.jpg` } : undefined });
const pages: WikiPage[] = [
  page(1, "Igreja de São Roque", "Jesuit church in Portugal", 56104),
  page(2, "Timeline of Lisbon", "", 40988, false),
  page(3, "National Republican Guard (Portugal)", "National gendarmerie force of Portugal", 40669),
  page(4, "2025 Ascensor da Glória derailment", "2025 railway accident in Portugal", 34972),
  page(5, "São Jorge Castle", "Historic castle in Lisbon, Portugal", 22148),
  page(6, "Bairro Alto", "Neighborhood of Lisbon in Misericórdia", 21390),
  page(7, "Siege of Lisbon", "1147 Second Crusade battle", 20012),
  page(8, "Santa Justa Lift", "Municipal elevator in Lisbon, Portugal", 19342),
  page(9, "Teatro da Rua dos Condes", "Former theatre in Lisbon, Portugal", 12602),
  page(10, "Café A Brasileira", "Café in Lisbon, in the old quarter Chiado", 11291),
  page(11, "Rossio", "Town square in Lisbon, Portugal", 8221),
  page(12, "Teatro Nacional de São Carlos", "Building in Lisbon, Portugal", 8134),
  page(13, "Hospital Real de Todos-os-Santos", "Hospital in Lisbon, Portugal", 8038),
  page(14, "Restauradores Station", "Metro station in Lisbon, Portugal", 5178),
  page(15, "Museu Nacional de Arte Antiga", "Art museum in Lisbon, Portugal", 7000),
];

describe("a city's sights", () => {
  it("keeps places, the best known first, and leaves out the rest", () => {
    const s = sightsFromWikipedia(pages);
    expect(s.map((x) => x.name)).toEqual(["Igreja de São Roque", "São Jorge Castle", "Bairro Alto", "Santa Justa Lift", "Café A Brasileira", "Rossio", "Teatro Nacional de São Carlos", "Museu Nacional de Arte Antiga"]);
  });
  it("gives each its kind, picture and page", () => {
    const s = sightsFromWikipedia(pages);
    const by = Object.fromEntries(s.map((x) => [x.name, x]));
    expect(by["Igreja de São Roque"].cls).toBe("place_of_worship");
    expect(by["São Jorge Castle"].cls).toBe("castle");
    expect(by["Museu Nacional de Arte Antiga"].cls).toBe("museum");
    expect(by["Café A Brasileira"].cls).toBe("cafe");
    expect(by["Rossio"].cls).toBe("attraction");
    expect(by["Santa Justa Lift"].image).toContain("upload.wikimedia.org");
    expect(by["Santa Justa Lift"].url).toBe("https://en.wikipedia.org/?curid=8");
    expect(sightsFromWikipedia(pages, 3)).toHaveLength(3);
  });
});
