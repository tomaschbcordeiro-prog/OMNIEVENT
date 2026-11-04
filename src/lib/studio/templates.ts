import type { PosterStyle } from "./poster";

/**
 * Studio templates: the usual shapes of an event, so an organiser starts halfway there. Each
 * fills in the kind of event, typical times, entry and tickets, a programme and a description
 * to adapt, and a poster style.
 */
export interface StudioTemplate {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  group: string;
  category?: string;
  genres: string[];
  time: string;
  endTime?: string;
  repeat?: "weekly";
  access: "free" | "ticketed" | "registration";
  tiers?: { name: string; price: number }[];
  ageMin?: number;
  familyFriendly?: boolean;
  programme?: { time: string; title: string }[];
  description: string;
  posterStyle: PosterStyle;
  hue: number;
}

export const TEMPLATES: StudioTemplate[] = [
  {
    id: "concert",
    name: "Live concert",
    emoji: "🎸",
    blurb: "A band or artist on stage",
    group: "music",
    category: "concerts",
    genres: ["Live music"],
    time: "21:00",
    endTime: "23:30",
    access: "ticketed",
    tiers: [
      { name: "Early bird", price: 10 },
      { name: "Regular", price: 15 },
    ],
    programme: [
      { time: "20:30", title: "Doors open" },
      { time: "21:00", title: "Support act" },
      { time: "22:00", title: "Main set" },
    ],
    description: "Who's playing, and why you shouldn't miss it.\n\nWhat the night sounds like: the style, the songs, the mood.\n\nGood to know: doors, the bar, how to get there.",
    posterStyle: "bold",
    hue: 265,
  },
  {
    id: "club-night",
    name: "Club night",
    emoji: "🪩",
    blurb: "DJs until late",
    group: "nightlife",
    category: "club-nights",
    genres: ["House", "Techno"],
    time: "23:00",
    endTime: "05:00",
    access: "ticketed",
    tiers: [
      { name: "Before 1am", price: 8 },
      { name: "At the door", price: 12 },
    ],
    ageMin: 18,
    programme: [
      { time: "23:00", title: "Warm-up" },
      { time: "01:00", title: "Headliner" },
      { time: "03:30", title: "Closing set" },
    ],
    description: "The line-up and the sound.\n\nThe room, the system, the vibe.\n\nDoor policy and what to bring (ID: 18+).",
    posterStyle: "neon",
    hue: 300,
  },
  {
    id: "open-mic",
    name: "Open mic",
    emoji: "🎤",
    blurb: "Anyone can take the stage",
    group: "comedy",
    category: "stand-up",
    genres: ["Open mic"],
    time: "20:30",
    endTime: "23:00",
    repeat: "weekly",
    access: "free",
    programme: [
      { time: "20:00", title: "Sign-up list opens" },
      { time: "20:30", title: "First act" },
    ],
    description: "Comedy, music, poetry: five minutes each.\n\nHow to sign up, and how long each slot is.\n\nCome to perform or just to watch.",
    posterStyle: "minimal",
    hue: 20,
  },
  {
    id: "supper-club",
    name: "Supper club",
    emoji: "🍷",
    blurb: "A shared table, a set menu",
    group: "food-drink",
    category: "supper-clubs",
    genres: ["Supper club"],
    time: "20:00",
    endTime: "23:00",
    access: "ticketed",
    tiers: [{ name: "Dinner", price: 45 }],
    programme: [
      { time: "20:00", title: "Welcome drink" },
      { time: "20:30", title: "Dinner is served" },
    ],
    description: "The menu, course by course.\n\nWho's cooking and the story behind it.\n\nDietary needs: tell us when you book.",
    posterStyle: "retro",
    hue: 15,
  },
  {
    id: "run-club",
    name: "Run club",
    emoji: "🏃",
    blurb: "A group run, all paces",
    group: "sports",
    category: "marathon",
    genres: ["Running", "Run club"],
    time: "08:00",
    endTime: "09:30",
    repeat: "weekly",
    access: "free",
    familyFriendly: false,
    description: "The route and the distance (with a shorter option).\n\nAll paces welcome: nobody gets left behind.\n\nWhere we meet, and coffee after.",
    posterStyle: "bold",
    hue: 140,
  },
  {
    id: "workshop",
    name: "Workshop",
    emoji: "🛠️",
    blurb: "Learn by doing",
    group: "education",
    category: "creative-workshops",
    genres: ["Workshop"],
    time: "18:30",
    endTime: "20:30",
    access: "registration",
    description: "What you'll learn and make.\n\nWho it's for (no experience needed?).\n\nWhat's included, and what to bring.",
    posterStyle: "minimal",
    hue: 200,
  },
  {
    id: "market",
    name: "Market or fair",
    emoji: "🧺",
    blurb: "Stalls, makers, food",
    group: "festivals",
    category: "street-festivals",
    genres: ["Market", "Makers"],
    time: "10:00",
    endTime: "18:00",
    access: "free",
    familyFriendly: true,
    description: "Who's selling: makers, food, vintage…\n\nMusic, activities for kids, anything special.\n\nHow to get there, and whether to bring cash.",
    posterStyle: "retro",
    hue: 40,
  },
  {
    id: "exhibition",
    name: "Exhibition opening",
    emoji: "🖼️",
    blurb: "A vernissage or show",
    group: "exhibitions",
    category: "art-exhibitions",
    genres: ["Opening night"],
    time: "18:30",
    endTime: "21:30",
    access: "free",
    programme: [
      { time: "18:30", title: "Doors open" },
      { time: "19:30", title: "Talk with the artist" },
    ],
    description: "The artist and the work.\n\nWhat the show is about.\n\nHow long it runs after the opening.",
    posterStyle: "minimal",
    hue: 220,
  },
  {
    id: "match",
    name: "Match or tournament",
    emoji: "⚽",
    blurb: "Teams, a pitch, a result",
    group: "sports",
    category: "football",
    genres: ["Tournament"],
    time: "15:00",
    endTime: "17:00",
    access: "ticketed",
    tiers: [{ name: "Standard", price: 5 }],
    description: "Who's playing and what's at stake.\n\nKick-off, the format, the prizes.\n\nFood, drinks and where to watch from.",
    posterStyle: "bold",
    hue: 120,
  },
  {
    id: "family-day",
    name: "Family day",
    emoji: "🧸",
    blurb: "Fun for kids and parents",
    group: "family",
    category: "family-shows",
    genres: ["Kids"],
    time: "10:30",
    endTime: "12:30",
    access: "ticketed",
    tiers: [
      { name: "Child", price: 6 },
      { name: "Adult", price: 8 },
    ],
    familyFriendly: true,
    description: "What the kids will do (and the ages it suits).\n\nWhat grown-ups get up to meanwhile.\n\nPrams, snacks and toilets: the practical bits.",
    posterStyle: "retro",
    hue: 330,
  },
  {
    id: "screening",
    name: "Film screening",
    emoji: "🎬",
    blurb: "A film, a room, a crowd",
    group: "cinema",
    category: "outdoor-cinema",
    genres: ["Screening"],
    time: "21:30",
    access: "ticketed",
    tiers: [{ name: "Ticket", price: 6 }],
    description: "The film: year, director, why now.\n\nSubtitles and the running time.\n\nBring a blanket if it's outside.",
    posterStyle: "neon",
    hue: 210,
  },
  {
    id: "meetup",
    name: "Meetup or talk",
    emoji: "💡",
    blurb: "Ideas, people, a mic",
    group: "technology",
    category: "startup-events",
    genres: ["Meetup", "Networking"],
    time: "18:30",
    endTime: "20:30",
    access: "registration",
    programme: [
      { time: "18:30", title: "Doors and networking" },
      { time: "19:00", title: "Talks" },
      { time: "20:00", title: "Q&A and drinks" },
    ],
    description: "The topic and the speakers.\n\nWho should come.\n\nFood and drinks, and how to get in.",
    posterStyle: "minimal",
    hue: 190,
  },
];

export const getTemplate = (id: string | null | undefined) => TEMPLATES.find((t) => t.id === id);
