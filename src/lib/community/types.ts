/** Community data shared by the server and the browser. */

/** e: event id, v: venue slug, p: participant slug, d: destination (city) id, k: club id (its wall). */
export type TargetKind = "e" | "v" | "p" | "d" | "k";
export const TARGET_RE = /^(e|v|p|d|k):[A-Za-z0-9._~:-]{1,160}$/;

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
  /** Member number, in the order people joined (missing on profiles made before numbering). */
  no?: number;
}

export interface PublicProfile extends Profile {
  karma: number;
  counts: { posts: number; reviews: number; likes: number; going: number; duels: number; founded: number };
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
  /** The newest members, newest first: the welcome row. */
  newcomers?: PublicProfile[];
  feed: FeedItem[];
  trending: (TargetMeta & Summary)[];
  topRated: (TargetMeta & Summary)[];
  leaders: PublicProfile[];
  profiles: Record<string, PublicProfile>;
  persistent: boolean;
}

export const BADGES: Record<string, { label: string; emoji: string; hint: string }> = {
  newcomer: { label: "Newcomer", emoji: "🌱", hint: "Joined the community" },
  founding: { label: "Founding member", emoji: "✨", hint: "One of the first 1,000 members" },
  voice: { label: "First words", emoji: "💬", hint: "Wrote a first post" },
  critic: { label: "Critic", emoji: "⭐", hint: "Rated 5 places or events" },
  helper: { label: "Helpful", emoji: "🤝", hint: "Got 10 likes" },
  regular: { label: "Regular", emoji: "🎟️", hint: "Planned to go to 5 events" },
  duelist: { label: "Duelist", emoji: "⚔️", hint: "Played the daily duel on 7 days" },
  founder: { label: "Club founder", emoji: "👑", hint: "Started a club" },
  storyteller: { label: "Storyteller", emoji: "📣", hint: "Wrote 25 posts" },
  legend: { label: "Local legend", emoji: "🏆", hint: "Earned 250 points" },
};

/** The first members are founding members: the first 1,000, and everyone who joined before launch. */
export const FOUNDING_LIMIT = 1000;
export const FOUNDING_UNTIL = "2027-03-01T00:00:00Z";
export function isFounding(p: { no?: number; createdAt: string }): boolean {
  return p.no ? p.no <= FOUNDING_LIMIT : p.createdAt < FOUNDING_UNTIL;
}

export const AVATARS = ["🦊", "🐙", "🦉", "🐝", "🦄", "🐬", "🐸", "🦁", "🐼", "🐧", "🦋", "🐢", "🐳", "🦜", "🐨", "🦩", "🌻", "🌵", "🍉", "🎸", "🎧", "⚽", "🎭", "🎨", "🚲", "🛹", "🌍", "🌙", "⚡", "🔥"];

export const KIND_META: Record<PostKind, { label: string; emoji: string; placeholder: string }> = {
  comment: { label: "Chat", emoji: "💬", placeholder: "Say something to people going…" },
  question: { label: "Question", emoji: "❓", placeholder: "Ask the community: doors, bags, food, best seats…" },
  tip: { label: "Tip", emoji: "💡", placeholder: "Share a tip: getting there, where to eat, which entrance…" },
  meetup: { label: "Meet up", emoji: "👋", placeholder: "Going alone? Suggest a place to meet before or after…" },
  review: { label: "Review", emoji: "⭐", placeholder: "How was it? What should others know?" },
};

/**
 * Ways to start a conversation, one tap each, for every kind of page: a blank box is the
 * hardest thing to write in, and a question already half-asked gets people talking. Each
 * sets the kind of post and the opening words (the writer finishes the sentence).
 */
export type StarterMode = "event-upcoming" | "event-past" | "place" | "person" | "city" | "club";
export const STARTERS: Record<StarterMode, { kind: PostKind; label: string; text: string }[]> = {
  "event-upcoming": [
    { kind: "meetup", label: "Going alone", text: "Going on my own. Anyone up for meeting before, at " },
    { kind: "question", label: "Worth it?", text: "Is this worth it for a first-timer? " },
    { kind: "question", label: "Getting there", text: "What's the easiest way to get there and back? " },
    { kind: "tip", label: "Share a tip", text: "Tip for anyone going: " },
  ],
  "event-past": [
    { kind: "review", label: "Highlight", text: "The highlight for me was " },
    { kind: "comment", label: "Photos?", text: "Anyone take photos? " },
    { kind: "tip", label: "Next time", text: "If you go next time: " },
  ],
  place: [
    { kind: "tip", label: "Best seats", text: "Best place to sit or stand here: " },
    { kind: "question", label: "Bags & coats", text: "Is there a cloakroom, and can you bring a bag? " },
    { kind: "tip", label: "Eat nearby", text: "Good spot to eat or drink nearby: " },
  ],
  person: [
    { kind: "review", label: "Saw them live", text: "Saw them live: " },
    { kind: "question", label: "Next tour", text: "Any word on when they'll be back? " },
    { kind: "comment", label: "Favourite", text: "My favourite of theirs is " },
  ],
  city: [
    { kind: "tip", label: "Hidden gem", text: "Hidden gem this week: " },
    { kind: "question", label: "Tonight?", text: "What's on tonight that locals actually go to? " },
    { kind: "meetup", label: "New in town", text: "New in town. Anyone want to go out this weekend? " },
  ],
  club: [
    { kind: "comment", label: "What next?", text: "What should we go to next? " },
    { kind: "meetup", label: "Who's in?", text: "Who's in for " },
    { kind: "tip", label: "Found one", text: "Found one we'd like: " },
  ],
};

export interface Notice {
  type: "reply" | "like" | "follow" | "mention" | "react" | "join" | "club";
  by: string;
  post: string;
  target: string;
  at: string;
  /** Start of the reply or mention; for club notices, what happened ("asked to join"). */
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

// ---- Clubs ----------------------------------------------------------------------------------

export type ClubRole = "owner" | "admin" | "member";
export type ClubPrivacy = "open" | "request";

/** Crests a club can pick (no free text, so nothing to moderate). */
export const CLUB_EMOJIS = ["🎷", "🎸", "🎧", "🎻", "🥁", "🎤", "🎭", "🎬", "🎨", "📚", "⚽", "🏀", "🎾", "🏃", "🚴", "🧗", "🍷", "🍜", "☕", "🍸", "🪩", "🌙", "🌍", "🏛️", "🎪", "🎟️", "🔥", "💜", "🌈", "✨", "🦄", "🐙", "🦊", "🌻", "🌊", "⛰️"];

/** A club as everyone sees it. */
export interface Club {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  /** Hue of the club's colours, 0–359. */
  hue: number;
  tagline: string;
  about?: string;
  /** Top-level categories the club is into (music, theatre…). */
  vibes: string[];
  /** Its members' own words for what they love ("jazz", "techno", "indie films"). */
  tags: string[];
  cityId?: string;
  city?: string;
  privacy: ClubPrivacy;
  owner: string;
  createdAt: string;
}

/** A club in a list: counts, a few faces, and the viewer's place in it. */
export interface ClubCard extends Club {
  members: number;
  picks: number;
  faces: PublicProfile[];
  myRole?: ClubRole;
  requested?: boolean;
}

/** An event shared with a club, kept as it was when shared (reading it needs no catalogue). */
export interface ClubPick {
  id: string;
  slug: string;
  title: string;
  start: string;
  until?: string;
  timeZone: string;
  venueName: string;
  city: string;
  imageUrl?: string;
  hue?: number;
  categorySlug: string;
  groupSlug: string;
  by: string;
  at: string;
  votes: number;
  voted: boolean;
}

/** A club's page. What a viewer sees depends on the club's privacy and their role. */
export interface ClubPage {
  club: ClubCard;
  /** Members and the wall are shown to everyone in open clubs, to members only otherwise. */
  inside: boolean;
  members: { profile: PublicProfile; role: ClubRole; since: string }[];
  /** Join requests, for owners and admins. */
  requests: { profile: PublicProfile; at: string }[];
  picks: ClubPick[];
  /** What the club is into, from its vibes and the events members share. */
  taste: { group: string; share: number }[];
  profiles: Record<string, PublicProfile>;
}

export interface ClubDirectory {
  mine: ClubCard[];
  popular: ClubCard[];
  fresh: ClubCard[];
  total: number;
}
