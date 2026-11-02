/** Community data shared by the server and the browser. */

/** e: event id, v: venue slug, p: participant slug, d: destination (city) id. */
export type TargetKind = "e" | "v" | "p" | "d";
export const TARGET_RE = /^(e|v|p|d):[A-Za-z0-9._~:-]{1,160}$/;

export type PostKind = "comment" | "question" | "tip" | "meetup" | "review";
export const POST_KINDS: PostKind[] = ["comment", "question", "tip", "meetup", "review"];

export interface Profile {
  id: string;
  /** Shown to others: first and last name. */
  name: string;
  firstName?: string;
  lastName?: string;
  /** Unique handle, lower case; missing on profiles made before accounts existed. */
  username?: string;
  /** One emoji. */
  avatar: string;
  /** Hue of the avatar disc, 0–359. */
  hue: number;
  bio?: string;
  createdAt: string;
}

export interface PublicProfile extends Profile {
  karma: number;
  counts: { posts: number; reviews: number; likes: number; going: number; duels: number };
  badges: string[];
}

export interface TargetMeta {
  target: string;
  title: string;
  href: string;
  /** Short context line: venue and city for an event, city for a venue. */
  sub?: string;
  start?: string;
  timeZone?: string;
  imageUrl?: string;
  hue?: number;
  categorySlug?: string;
}

export interface Post {
  id: string;
  target: string;
  author: string;
  kind: PostKind;
  text: string;
  rating?: number;
  parent?: string;
  createdAt: string;
  editedAt?: string;
  deleted?: boolean;
  hidden?: boolean;
  /** Filled in when read. */
  likes?: number;
  liked?: boolean;
  /** Reactions by emoji (❤️ included), and the viewer's own. */
  reactions?: Record<string, number>;
  myReaction?: string;
  /** Meet-ups: how many said "I'm in", a few of them, and whether the viewer did. */
  joins?: number;
  joined?: boolean;
  joiners?: string[];
  replies?: Post[];
}

/** One reaction per member and post; ❤️ is the classic like. */
export const REACTIONS = ["❤️", "🔥", "😂", "🙌", "😮"] as const;

export const REPORT_REASONS: Record<string, string> = {
  spam: "Spam or advertising",
  scam: "Selling tickets or a scam",
  rude: "Rude, hateful or harassing",
  private: "Shares someone's private details",
  other: "Something else",
};

/** What changed in a conversation, cheap to check often. */
export interface ThreadHead {
  posts: number;
  latest: string | null;
}

export interface Summary {
  going: number;
  interested: number;
  posts: number;
  ratingAvg: number;
  ratingCount: number;
}

export interface Thread {
  target: string;
  summary: Summary;
  /** Count of each star value, 1 to 5. */
  ratingDist: number[];
  me?: { going: boolean; interested: boolean; rating?: number };
  goingPeople: string[];
  posts: Post[];
  profiles: Record<string, PublicProfile>;
  persistent: boolean;
}

export interface FeedItem {
  post: Post;
  meta?: TargetMeta;
}

export interface CommunityHome {
  stats: { members: number; posts: number; ratings: number; plans: number };
  feed: FeedItem[];
  trending: (TargetMeta & Summary)[];
  topRated: (TargetMeta & Summary)[];
  leaders: PublicProfile[];
  profiles: Record<string, PublicProfile>;
  persistent: boolean;
}

export const BADGES: Record<string, { label: string; emoji: string; hint: string }> = {
  newcomer: { label: "Newcomer", emoji: "🌱", hint: "Joined the community" },
  voice: { label: "First words", emoji: "💬", hint: "Wrote a first post" },
  critic: { label: "Critic", emoji: "⭐", hint: "Rated 5 places or events" },
  helper: { label: "Helpful", emoji: "🤝", hint: "Got 10 likes" },
  regular: { label: "Regular", emoji: "🎟️", hint: "Planned to go to 5 events" },
  duelist: { label: "Duelist", emoji: "⚔️", hint: "Played the daily duel on 7 days" },
  storyteller: { label: "Storyteller", emoji: "📣", hint: "Wrote 25 posts" },
  legend: { label: "Local legend", emoji: "🏆", hint: "Earned 250 points" },
};

export const AVATARS = ["🦊", "🐙", "🦉", "🐝", "🦄", "🐬", "🐸", "🦁", "🐼", "🐧", "🦋", "🐢", "🐳", "🦜", "🐨", "🦩", "🌻", "🌵", "🍉", "🎸", "🎧", "⚽", "🎭", "🎨", "🚲", "🛹", "🌍", "🌙", "⚡", "🔥"];

export const KIND_META: Record<PostKind, { label: string; emoji: string; placeholder: string }> = {
  comment: { label: "Chat", emoji: "💬", placeholder: "Say something to people going…" },
  question: { label: "Question", emoji: "❓", placeholder: "Ask the community: doors, bags, food, best seats…" },
  tip: { label: "Tip", emoji: "💡", placeholder: "Share a tip: getting there, where to eat, which entrance…" },
  meetup: { label: "Meet up", emoji: "👋", placeholder: "Going alone? Suggest a place to meet before or after…" },
  review: { label: "Review", emoji: "⭐", placeholder: "How was it? What should others know?" },
};

export interface Notice {
  type: "reply" | "like" | "follow" | "mention" | "react" | "join";
  by: string;
  post: string;
  target: string;
  at: string;
  /** Start of the reply or mention. */
  text?: string;
  /** The reaction, for reactions. */
  emoji?: string;
}

export interface Notices {
  items: (Notice & { meta?: TargetMeta })[];
  unread: number;
  profiles: Record<string, PublicProfile>;
}

/** What only the account holder sees about their own account. */
export interface AccountInfo {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
}

export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._]{1,18}[a-z0-9])$/;

/** Activity of the members someone follows: their posts and the events they plan to go to. */
export interface FollowingFeed {
  feed: FeedItem[];
  plans: { by: string; at: string; meta: TargetMeta }[];
  profiles: Record<string, PublicProfile>;
  following: number;
}

// ---- Daily duel ---------------------------------------------------------------------------

/** An event as the daily duel shows it, kept with the duel so reading it needs no catalogue. */
export interface DuelSide {
  id: string;
  slug: string;
  title: string;
  start: string;
  timeZone: string;
  hoursUnknown?: boolean;
  venueName: string;
  city: string;
  imageUrl?: string;
  hue?: number;
  categorySlug: string;
  groupSlug: string;
  isFree?: boolean;
}

export type DuelPick = "a" | "b";

export interface DuelRound {
  a: DuelSide;
  b: DuelSide;
  /** How everyone voted: only once the viewer has picked, so nobody just follows the crowd. */
  votes?: { a: number; b: number };
  mine?: DuelPick;
}

/** Today's duel: a few rounds of "this or that" between events in one city, the same for everyone. */
export interface Duel {
  day: string;
  cityId: string;
  city: string;
  rounds: DuelRound[];
  /** People who played today. */
  players: number;
  /** Days in a row the viewer played (today included once played), and their best run. */
  streak: { days: number; best: number; playedToday: boolean };
  /** Yesterday's winners, with their share of the votes. */
  yesterday?: { city: string; winners: (DuelSide & { pct: number; votes: number })[] };
  /** When the next duel starts (midnight UTC). */
  nextAt: string;
}
