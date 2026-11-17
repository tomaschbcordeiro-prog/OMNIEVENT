import { Disc3, Heart, Lightbulb, LifeBuoy, MapPinned, MessagesSquare, Plane, Sparkles, Users } from "lucide-react";

/**
 * The parts of Mundivi beyond the main tabs, each with one plain line that says what it does,
 * so nobody has to guess what "Match" or "Studio" means. The desktop "More" menu and the phone's
 * "More" sheet both use this list.
 */
export interface NavItem {
  href: string;
  label: string;
  note: string;
  Icon: typeof Heart;
  fresh?: boolean;
}

export const TRIPS: NavItem = { href: "/trips", label: "Trips", note: "Plan it on the globe", Icon: Plane };
export const COMMUNITY: NavItem = { href: "/community", label: "Community", note: "Reviews and tips", Icon: MessagesSquare };

export const EXTRA: NavItem[] = [
  { href: "/trips/ideas", label: "Trip ideas", note: "Ready-made routes", Icon: Lightbulb },
  { href: "/destinations", label: "Destinations", note: "Cities to explore", Icon: MapPinned },
  { href: "/match", label: "Match", note: "Swipe to find plans", Icon: Heart },
  { href: "/mixtape", label: "Mixtape", note: "A weekend, planned", Icon: Disc3 },
  { href: "/clubs", label: "Clubs", note: "Go out together", Icon: Users, fresh: true },
  { href: "/studio", label: "Studio", note: "List your event", Icon: Sparkles },
];

export const HELP: NavItem = { href: "/help", label: "Help", note: "How Mundivi works", Icon: LifeBuoy };
