/** The widths pictures are made at (a few, so each picture is cached in a few sizes only). */
export const THUMB_WIDTHS = [160, 480, 960] as const;

/**
 * A picture's address at about the width it's shown (double, for sharp screens), made by
 * /api/img. Pictures that aren't on https are left as they are.
 */
export function thumb(src: string | undefined, shownPx: number): string | undefined {
  if (!src?.startsWith("https://")) return src;
  const want = shownPx * 2;
  const w = THUMB_WIDTHS.find((x) => x >= want) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
  return `/api/img?u=${encodeURIComponent(src)}&w=${w}`;
}
