import { getCategory, groupOf, GROUP_HEX } from "@/lib/categories";
import { formatEventTime, formatShortDate, localDateKey } from "@/lib/format";
import type { EventView } from "@/lib/types";
import { CategoryIcon } from "./ui";

/**
 * For an event with no picture: a poster drawn from what we know, the date set large like a
 * ticket stub, in the colours of its category. (The title is the page's heading just below,
 * so it isn't repeated here.)
 */
export function EventPoster({ e }: { e: EventView }) {
  const group = groupOf(e.categorySlug);
  const accent = GROUP_HEX[group] ?? "#7c8db5";
  const hue = e.posterHue ?? 215;
  const d = formatShortDate(e.start, e.timeZone);
  const daily = e.eventType === "daily_attraction";
  // A run over several days: until when.
  const end = e.end && localDateKey(e.end, e.timeZone) !== localDateKey(e.start, e.timeZone) ? formatShortDate(e.end, e.timeZone) : null;
  const month = new Date(e.start).toLocaleDateString("en-GB", { month: "long", timeZone: e.timeZone });
  const weekday = new Date(e.start).toLocaleDateString("en-GB", { weekday: "long", timeZone: e.timeZone });
  const label = getCategory(e.categorySlug)?.name ?? getCategory(group)?.name ?? "Event";
  return (
    <div
      className="event-poster"
      aria-hidden
      style={{
        background: `radial-gradient(90% 130% at 100% 0%, ${accent}80, transparent 62%), radial-gradient(70% 100% at 0% 100%, hsl(${(hue + 40) % 360} 80% 52% / 0.42), transparent 60%), linear-gradient(135deg, hsl(${hue} 55% 16%), hsl(${(hue + 30) % 360} 58% 27%))`,
      }}
    >
      <span className="event-poster-mark" style={{ color: accent }}>
        <CategoryIcon slug={e.categorySlug} size={260} />
      </span>
      <div className="event-poster-body">
        <p className="event-poster-kicker">{label}</p>
        <p className="event-poster-day tnum">{daily ? "Daily" : d.day}</p>
        <p className="event-poster-when">
          {daily ? "Open every day" : `${month} · ${weekday}${e.hoursUnknown ? "" : `, ${formatEventTime(e.start, e.timeZone)}`}${end ? ` · until ${end.day} ${end.month}` : ""}`}
        </p>
        <p className="event-poster-where">
          {e.venue.name}
          <span> · {e.venue.city}</span>
        </p>
      </div>
    </div>
  );
}
