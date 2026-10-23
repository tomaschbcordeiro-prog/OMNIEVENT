/**
 * OMNIEVENT universal domain model.
 *
 * One event model powers every category (music, sports, theatre, attractions, …).
 * Category-specific information lives in optional, typed sub-structures
 * (`sports`, `schedule`, `timeSlots`) rather than separate schemas.
 */

export type ISODate = string; // ISO-8601 timestamp with offset (UTC "Z" preferred)
export type CurrencyCode = string; // ISO-4217, validated by zod at the boundary

export type EventStatus =
  | "scheduled"
  | "on_sale"
  | "sold_out"
  | "postponed"
  | "rescheduled"
  | "cancelled"
  | "completed"
  | "free_entry"
  | "registration_required"
  | "unknown";

export type TicketAccess =
  | "ticketed"
  | "free"
  | "registration"
  | "invitation_only"
  | "unknown";

export type Availability = "available" | "limited" | "sold_out" | "not_on_sale" | "unknown";

export type TicketCategory =
  | "general_admission"
  | "reserved"
  | "vip"
  | "premium"
  | "hospitality"
  | "family"
  | "child"
  | "student"
  | "group"
  | "accessible"
  | "day_pass"
  | "multi_day_pass"
  | "season"
  | "standard";

export type ParticipantRole =
  | "artist"
  | "headliner"
  | "support"
  | "team_home"
  | "team_away"
  | "team"
  | "athlete"
  | "speaker"
  | "performer"
  | "cast"
  | "organizer"
  | "competitor"
  | "dj";

export type ParticipantKind =
  | "artist"
  | "team"
  | "athlete"
  | "speaker"
  | "performer"
  | "organizer"
  | "production"
  | "competition";

export interface Provenance {
  /** Adapter id, e.g. "demo" or "ticketmaster". */
  provider: string;
  externalId: string;
  sourceUrl?: string;
  lastSyncedAt: ISODate;
  lastVerifiedAt?: ISODate;
  /** True for fictional demonstration records. Never mixed silently with real data. */
  isDemo: boolean;
  /** 0–1 completeness score computed from populated fields. */
  completeness?: number;
}

export interface Venue {
  id: string;
  slug: string;
  name: string;
  address?: string;
  city: string;
  cityId?: string;
  region?: string;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  timeZone: string;
  venueType?: string;
  capacity?: number;
  url?: string;
  accessibility?: string[];
  indoor?: boolean;
  provenance: Provenance;
}

export interface Participant {
  id: string;
  slug: string;
  name: string;
  kind: ParticipantKind;
  description?: string;
  imageUrl?: string;
  country?: string;
  url?: string;
  provenance: Provenance;
}

export interface EventParticipant {
  participantId: string;
  role: ParticipantRole;
  order?: number;
}

export interface TicketOffer {
  id: string;
  eventId: string;
  provider: string;
  providerType: "primary" | "official_resale" | "box_office" | "organizer" | "marketplace";
  providerEventId?: string;
  ticketCategory: TicketCategory;
  label?: string;
  /** Advertised base price per ticket (minimum if a range). */
  basePrice?: number;
  maxPrice?: number;
  /** Mandatory fees per ticket where known. */
  feeAmount?: number;
  /** Total per-ticket price, set only when the source verifies it. */
  totalPrice?: number;
  /** Whether `basePrice` already includes mandatory fees. undefined = unknown. */
  feesIncluded?: boolean;
  currency: CurrencyCode;
  availability: Availability;
  purchaseUrl?: string;
  priceObservedAt?: ISODate;
  availabilityVerifiedAt?: ISODate;
  sponsored?: boolean;
  isDemo: boolean;
}

export interface SportsInfo {
  sport: string;
  competition?: string;
  league?: string;
  stage?: string;
  season?: string;
}

export interface TimeSlot {
  start: ISODate;
  end?: ISODate;
  availability: Availability;
}

export interface OmniEvent {
  id: string;
  canonicalId: string;
  slug: string;
  title: string;
  description?: string;
  /** Category slug of the most specific category (leaf or branch). */
  categorySlug: string;
  /** Primary top-level group slug, derived from the category tree. */
  groupSlug: string;
  eventType: "single" | "recurring" | "multi_day" | "daily_attraction";
  venueId: string;
  start: ISODate;
  end?: ISODate;
  timeZone: string;
  durationMinutes?: number;
  status: EventStatus;
  ticketAccess: TicketAccess;
  isFree: boolean;
  registrationRequired: boolean;
  online: boolean;
  familyFriendly: boolean;
  ageRestriction?: { minAge?: number; guardianRequiredUnder?: number; note?: string };
  accessibility?: string[];
  statusNote?: string;
  rescheduledFrom?: ISODate;
  officialUrl?: string;
  imageUrl?: string;
  /** Hue used for the generated poster when no image is available. */
  posterHue?: number;
  participants: EventParticipant[];
  sports?: SportsInfo;
  /** For recurring productions: other performance start times. */
  schedule?: ISODate[];
  timeSlots?: TimeSlot[];
  tags?: string[];
  announcedAt?: ISODate;
  editorialPick?: boolean;
  provenance: Provenance;
}

/** Event joined with its venue, offers and participants, as returned by APIs. */
export interface EventView extends OmniEvent {
  venue: Venue;
  offers: TicketOffer[];
  people: (Participant & { role: ParticipantRole })[];
  /** Cheapest verified advertised base price, in event currency. */
  fromPrice?: { amount: number; currency: CurrencyCode; feesIncluded?: boolean };
  distanceKm?: number;
}

export interface EventCard {
  id: string;
  slug: string;
  title: string;
  categorySlug: string;
  groupSlug: string;
  start: ISODate;
  timeZone: string;
  status: EventStatus;
  ticketAccess: TicketAccess;
  isFree: boolean;
  familyFriendly: boolean;
  online: boolean;
  venueName: string;
  venueSlug: string;
  city: string;
  cityId?: string;
  country: string;
  lat: number;
  lng: number;
  imageUrl?: string;
  posterHue?: number;
  people: { name: string; slug: string; role: ParticipantRole }[];
  sports?: SportsInfo;
  fromPrice?: { amount: number; currency: CurrencyCode; feesIncluded?: boolean };
  providers: string[];
  isDemo: boolean;
  provider: string;
  lastSyncedAt: ISODate;
  distanceKm?: number;
  editorialPick?: boolean;
  eventType: OmniEvent["eventType"];
}

export interface Category {
  slug: string;
  name: string;
  parent?: string;
  icon: string;
  description?: string;
  order: number;
  active: boolean;
  /** Marker colour token (top-level groups only). */
  color?: string;
  /** Free-text synonyms used by the search parser. */
  keywords?: string[];
}

export type DestinationKind = "continent" | "country" | "region" | "city";

export interface Destination {
  id: string;
  slug: string;
  name: string;
  kind: DestinationKind;
  parentId?: string;
  countryCode?: string;
  country?: string;
  continent?: string;
  lat: number;
  lng: number;
  timeZone?: string;
  currency?: CurrencyCode;
  aliases?: string[];
  population?: number;
  /** Southern hemisphere flag, used when interpreting seasons. */
  southern?: boolean;
}

export interface Cluster {
  id: string;
  lat: number;
  lng: number;
  count: number;
  groups: Record<string, number>;
  dominant: string;
  label: string;
  cityId?: string;
  venueId?: string;
  /** Up to 6 sample events for previews. */
  sample: EventCard[];
}

export interface SearchFilters {
  q?: string;
  categories?: string[];
  from?: string; // YYYY-MM-DD
  to?: string;
  city?: string; // destination id
  country?: string; // ISO country code
  continent?: string;
  near?: { lat: number; lng: number; radiusKm: number };
  minPrice?: number;
  maxPrice?: number;
  currency?: CurrencyCode;
  status?: EventStatus[];
  access?: "ticketed" | "free" | "registration";
  family?: boolean;
  online?: "online" | "in_person";
  accessible?: boolean;
  indoor?: "indoor" | "outdoor";
  participant?: string;
  venue?: string;
  sport?: string;
  competition?: string;
  source?: "all" | "demo" | "live";
  sort?: "relevance" | "date" | "price" | "distance" | "announced";
  page?: number;
  pageSize?: number;
}

export interface ParsedQuery {
  filters: SearchFilters;
  /** Human-readable interpretation chips. */
  interpretation: { key: string; label: string }[];
  /** Suggestions shown when the parser was not confident. */
  ambiguities: string[];
  /** Text left over after extracting structured parts. */
  residual: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface ProviderStatus {
  id: string;
  name: string;
  enabled: boolean;
  isDemo: boolean;
  configured: boolean;
  lastRun?: SyncRun;
  coverage: string;
  attribution?: string;
}

export interface SyncRun {
  provider: string;
  runId: string;
  startedAt: ISODate;
  finishedAt?: ISODate;
  imported: number;
  updated: number;
  failures: number;
  rateLimited: boolean;
  ok: boolean;
  error?: string;
}
