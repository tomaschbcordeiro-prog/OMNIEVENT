/** Structured JSON logging (stdout). Swap for a log drain / OpenTelemetry in production. */
export function log(level: "debug" | "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra });
  if (level === "error") console.error(line);
  else console.log(line);
}
