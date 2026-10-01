import type { Occasion, Pace, PlaceCategory } from '../types';

/**
 * One reason a stop suits an occasion. A place earns the rule's point when it
 * has any of these tags, or is in one of these categories ("cat:cafe").
 */
export interface OccasionRule {
  match: string[];
  /** Short phrase used in explanations, e.g. "a scenic spot". */
  phrase: string;
}

export interface OccasionProfile {
  id: Occasion;
  label: string;
  blurb: string;
  /** Up to two rules; each matching rule is one point (0–2 per place). */
  rules: OccasionRule[];
  /** Tags that cost a point, e.g. "lively" for a walking meeting. Points never go below 0. */
  avoid: string[];
  /** Starting values for the form when this mode is picked. The user can change all of them. */
  defaults: { durationMin: number; budgetInr: number; pace: Pace; requireCafe: boolean };
  /** "walking" ranks plans by how much of the time is spent walking, for exercise. */
  rank: 'stops' | 'walking';
  /** Tighter stop cap than the global one, if this mode wants fewer stops. */
  maxStops?: number;
}

export const OCCASIONS: Record<Occasion, OccasionProfile> = {
  date: {
    id: 'date',
    label: 'Date',
    blurb: 'Scenic stops and somewhere cozy, at an unhurried pace.',
    rules: [
      { match: ['scenic', 'view', 'nature'], phrase: 'a scenic spot' },
      { match: ['dessert', 'cozy', 'coffee'], phrase: 'somewhere cozy for coffee or dessert' },
    ],
    avoid: ['quick'],
    defaults: { durationMin: 60, budgetInr: 300, pace: 'relaxed', requireCafe: true },
    rank: 'stops',
  },
  friends: {
    id: 'friends',
    label: 'Friends',
    blurb: 'Lively places to hang out and something to eat.',
    rules: [
      { match: ['group', 'lively'], phrase: 'a lively group spot' },
      { match: ['cat:cafe', 'snacks'], phrase: 'food' },
    ],
    avoid: [],
    defaults: { durationMin: 60, budgetInr: 200, pace: 'normal', requireCafe: false },
    rank: 'stops',
  },
  catchup: {
    id: 'catchup',
    label: 'Catch-up',
    blurb: 'Quiet spots to sit and talk properly.',
    rules: [
      { match: ['quiet', 'conversation'], phrase: 'a quiet place to talk' },
      { match: ['cat:seating', 'seating', 'cozy'], phrase: 'somewhere to sit' },
    ],
    avoid: ['lively'],
    defaults: { durationMin: 45, budgetInr: 150, pace: 'relaxed', requireCafe: false },
    rank: 'stops',
  },
  meeting: {
    id: 'meeting',
    label: 'Walking meeting',
    blurb: 'Calm, short and focused. At most two stops, away from crowds.',
    rules: [
      { match: ['quiet', 'conversation', 'wifi'], phrase: 'a calm spot to talk' },
      { match: ['seating', 'cat:seating', 'coffee'], phrase: 'a place to sit or grab coffee' },
    ],
    avoid: ['lively', 'group'],
    defaults: { durationMin: 45, budgetInr: 0, pace: 'normal', requireCafe: false },
    rank: 'stops',
    maxStops: 2,
  },
  guest: {
    id: 'guest',
    label: 'Show someone around',
    blurb: 'Landmarks and photo spots for a visitor.',
    rules: [
      { match: ['cat:landmark', 'iconic'], phrase: 'a landmark' },
      { match: ['photo', 'scenic', 'view'], phrase: 'a photo spot' },
    ],
    avoid: [],
    defaults: { durationMin: 90, budgetInr: 200, pace: 'relaxed', requireCafe: false },
    rank: 'stops',
  },
  solo: {
    id: 'solo',
    label: 'Solo reset',
    blurb: 'A calm walk alone with green, quiet places.',
    rules: [
      { match: ['quiet', 'nature'], phrase: 'somewhere calm' },
      { match: ['scenic', 'shade', 'seating'], phrase: 'a place to pause' },
    ],
    avoid: ['lively', 'group'],
    defaults: { durationMin: 45, budgetInr: 0, pace: 'relaxed', requireCafe: false },
    rank: 'stops',
  },
  study_break: {
    id: 'study_break',
    label: 'Study break',
    blurb: 'A quick snack and a stretch, then back to work.',
    rules: [
      { match: ['quick', 'snacks'], phrase: 'a quick snack' },
      { match: ['coffee', 'seating'], phrase: 'coffee or a seat' },
    ],
    avoid: [],
    defaults: { durationMin: 45, budgetInr: 200, pace: 'normal', requireCafe: true },
    rank: 'stops',
    maxStops: 2,
  },
  active: {
    id: 'active',
    label: 'Active walk',
    blurb: 'Mostly walking, hills welcome. Stops are optional.',
    rules: [],
    avoid: [],
    defaults: { durationMin: 45, budgetInr: 0, pace: 'normal', requireCafe: false },
    rank: 'walking',
    maxStops: 2,
  },
};

export const OCCASION_IDS = Object.keys(OCCASIONS) as Occasion[];

export function isOccasion(value: unknown): value is Occasion {
  return typeof value === 'string' && Object.hasOwn(OCCASIONS, value);
}

function ruleMatches(rule: OccasionRule, category: PlaceCategory, tags: Set<string>): boolean {
  return rule.match.some((m) => (m.startsWith('cat:') ? m.slice(4) === category : tags.has(m)));
}

/** 0–2 points: one per matching rule, minus one per avoided tag, never below 0. */
export function occasionPoints(category: PlaceCategory, tags: string[], occasion: Occasion): number {
  const profile = OCCASIONS[occasion];
  const set = new Set(tags);
  const earned = profile.rules.filter((r) => ruleMatches(r, category, set)).length;
  const penalty = profile.avoid.filter((t) => set.has(t)).length;
  return Math.max(0, earned - penalty);
}

/** Phrases for the rules that at least one of these places satisfies, in rule order. */
export function matchedPhrases(places: { category: PlaceCategory; tags: string[] }[], occasion: Occasion): string[] {
  return OCCASIONS[occasion].rules
    .filter((r) => places.some((p) => ruleMatches(r, p.category, new Set(p.tags))))
    .map((r) => r.phrase);
}
