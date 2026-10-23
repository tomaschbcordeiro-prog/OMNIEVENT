import { NextRequest } from "next/server";
import { z } from "zod";
import { parseQuery } from "@/lib/search/parse";
import { handler, ok, validationError } from "@/lib/api";

const schema = z.object({ q: z.string().min(1).max(200), tz: z.string().max(60).optional() });

/** GET /api/search/parse?q=… — natural-language query → structured filters + interpretation chips. */
export const GET = handler(async (req: NextRequest) => {
  const p = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success) return validationError(p.error);
  let tz: string | undefined = p.data.tz;
  try {
    if (tz) new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    tz = undefined;
  }
  return ok(parseQuery(p.data.q, { timeZone: tz }));
});
