import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type OgFont = { name: string; data: Buffer; weight: 400 | 700 | 900; style: "normal" };

/**
 * Geist, the site's own typeface, for images drawn on the server (posters, share cards): read
 * once per server. Routes that use it list ./public/fonts in outputFileTracingIncludes.
 */
let fonts: Promise<OgFont[]> | undefined;
export const loadOgFonts = () =>
  (fonts ??= Promise.all(
    ([["Regular", 400], ["Bold", 700], ["Black", 900]] as const).map(async ([file, weight]) => ({
      name: "Geist",
      data: await readFile(join(process.cwd(), "public", "fonts", `Geist-${file}.ttf`)),
      weight,
      style: "normal" as const,
    })),
  ).catch(() => {
    fonts = undefined;
    return [];
  }));
