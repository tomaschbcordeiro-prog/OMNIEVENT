import { describe, expect, it } from "vitest";
import { extractEvent } from "@/lib/studio/magic";
import { TEMPLATES } from "@/lib/studio/templates";
import { getCategory } from "@/lib/categories";

const NOW = new Date(2026, 10, 4, 12, 0); // Wed 4 Nov 2026, local time

describe("magic paste", () => {
  it("reads a Portuguese Instagram caption", () => {
    const x = extractEvent(
      `🎷 NOITE DE JAZZ NO TEJO 🎷
Sábado, 14 de novembro, às 21h30 até 23h30
📍 Clube Ferroviário, Lisboa
Bilhetes: 12€ / 15€ à porta
Com Maria João e Mário Laginha
Maiores de 16
https://www.bol.pt/Comprar/Bilhetes/123
#jazz #lisboa #livemusic`,
      NOW,
    );
    expect(x.title).toBe("Noite de Jazz no Tejo");
    expect(x.date).toBe("2026-11-14");
    expect([x.time, x.endTime]).toEqual(["21:30", "23:30"]);
    expect(x.prices).toEqual([12, 15]);
    expect(x.currency).toBe("EUR");
    expect(x.free).toBe(false);
    expect(x.venueName).toBe("Clube Ferroviário");
    expect(x.placeQuery).toBe("Clube Ferroviário, Lisboa");
    expect(x.ticketUrl).toBe("https://www.bol.pt/Comprar/Bilhetes/123");
    expect(x.group).toBe("music");
    expect(x.category).toBe("jazz");
    expect(x.genres).toEqual(["jazz", "lisboa", "livemusic"]);
    expect(x.performers).toEqual(["Maria João", "Mário Laginha"]);
    expect(x.ageMin).toBe(16);
    expect(x.found).toEqual(expect.arrayContaining(["name", "date", "time", "prices", "place", "kind of event", "line-up", "age"]));
  });

  it("reads an English flyer with am/pm, a month name first and free entry", () => {
    const x = extractEvent(
      `Sunset Run Club
Every Saturday from December 5th, 8am
Meet at Belém Tower
Free, all paces welcome! Coffee after.
instagram.com/sunsetrunclub`,
      NOW,
    );
    expect(x.title).toBe("Sunset Run Club");
    expect(x.date).toBe("2026-12-05");
    expect(x.time).toBe("08:00");
    expect(x.free).toBe(true);
    expect(x.venueName).toBe("Belém Tower");
    expect(x.organiserUrl).toBe("https://instagram.com/sunsetrunclub");
  });

  it("understands numeric dates, next year and weekdays", () => {
    expect(extractEvent("Open mic\n02/01 20:30", NOW).date).toBe("2027-01-02"); // already past this year
    expect(extractEvent("Feira\n2026-12-20", NOW).date).toBe("2026-12-20");
    expect(extractEvent("Quiz night\nThis Friday 9pm", NOW).date).toBe("2026-11-06");
    expect(extractEvent("Concerto amanhã às 19h", NOW).date).toBe("2026-11-05");
    expect(extractEvent("Concerto amanhã às 19h", NOW).time).toBe("19:00");
  });

  it("doesn't invent what isn't there", () => {
    const x = extractEvent("Something nice", NOW);
    expect(x.title).toBe("Something nice");
    expect([x.date, x.time, x.free, x.venueName, x.group]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(x.prices).toEqual([]);
    expect(extractEvent("", NOW).found).toEqual([]);
  });
});

describe("studio templates", () => {
  it("each uses a real category, valid times and sensible tickets", () => {
    for (const t of TEMPLATES) {
      expect(getCategory(t.group)?.active).toBe(true);
      if (t.category) expect(getCategory(t.category)?.parent).toBe(t.group);
      expect(t.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      if (t.access === "ticketed") expect(t.tiers?.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(30);
    }
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });
});
