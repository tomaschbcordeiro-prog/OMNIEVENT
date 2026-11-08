import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Marked } from "@/components/marked";

const html = (text: string, terms?: string[]) => renderToStaticMarkup(createElement(Marked, { text, terms }));

describe("Marked", () => {
  it("marks searched words, ignoring case and accents", () => {
    expect(html("Noite de Fado no Café", ["fado", "cafe"])).toBe('Noite de <mark class="hit">Fado</mark> no <mark class="hit">Café</mark>');
  });
  it("leaves titles alone when nothing matches or nothing was searched", () => {
    expect(html("Jazz at the Lake", ["opera"])).toBe("Jazz at the Lake");
    expect(html("Jazz at the Lake")).toBe("Jazz at the Lake");
  });
  it("doesn't overlap marks", () => {
    expect(html("Rock rock", ["rock", "roc"])).toBe('<mark class="hit">Rock</mark> <mark class="hit">rock</mark>');
  });
});
