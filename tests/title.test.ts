import { describe, expect, it } from "vitest";
import { tidyTitle } from "@/lib/title";

describe("titles typed in capitals", () => {
  it("are shown in ordinary case", () => {
    expect(tidyTitle("BILHETE MUSEU + EXPOSIÇÃO TEMPORÁRIA – PAVILHÃO PRETO")).toBe("Bilhete Museu + Exposição Temporária – Pavilhão Preto");
    expect(tidyTitle("VISITA À ADEGA DA CASA DA TORRE")).toBe("Visita à Adega da Casa da Torre");
    expect(tidyTitle("PORTES OUVERTES CHEZ HURON À ESCHAU : VENEZ DÉCOUVRIR L'ENTREPRISE !")).toBe("Portes Ouvertes Chez Huron à Eschau : Venez Découvrir L'entreprise !");
    expect(tidyTitle("THE BEST OF QUEEN: LIVE IN CONCERT")).toBe("The Best of Queen: Live in Concert");
  });
  it("keep initials, numbers and the first word", () => {
    expect(tidyTitle("DJ SET NO CCB COM DJ KAMALA 2026")).toBe("DJ Set no CCB com DJ Kamala 2026");
    expect(tidyTitle("DE VOLTA AO TEATRO NACIONAL")).toBe("De Volta ao Teatro Nacional");
    expect(tidyTitle("FESTIVAL ROCK-IN-RIO LISBOA")).toBe("Festival Rock-in-Rio Lisboa");
  });
  it("leave mixed-case and short titles alone", () => {
    expect(tidyTitle("Fado na Mouraria")).toBe("Fado na Mouraria");
    expect(tidyTitle("ABBA")).toBe("ABBA");
    expect(tidyTitle("NOS Alive 2026")).toBe("NOS Alive 2026");
  });
});

describe("ambiguous capitals", () => {
  it("read Portuguese words as words", () => {
    expect(tidyTitle("CONCERTO NOS JARDINS DE BELÉM")).toBe("Concerto nos Jardins de Belém");
    expect(tidyTitle("EU E TU NO TEATRO DO BAIRRO")).toBe("Eu e Tu no Teatro do Bairro");
  });
});
