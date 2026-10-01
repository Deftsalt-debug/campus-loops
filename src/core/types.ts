// Shared data shapes for the routing core. Units are explicit in field names:
// meters, seconds, minutes, INR. Coordinates are always [lat, lng].

export type LatLng = [number, number];

export interface GraphNode {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  /** Height above sea level. Used to derive edge ascent when an edge has no explicit value. */
  elevationM?: number;
}

/** One directed arc. A path walkable both ways is two arcs sharing a segmentId. */
export interface Edge {
  id: string;
  /** Same physical segment in either direction; used for retracing and overlap checks. */
  segmentId: string;
  from: string;
  to: string;
  meters: number;
  /** Nonnegative allowance for a crossing, gate or similar wait. */
  delaySeconds: number;
  /** Climb along this direction. Overrides the value derived from node elevations. */
  ascentMeters?: number;
  geometry: LatLng[];
  allowed: boolean;
  steps: boolean;
  /** Roofed or otherwise sheltered from rain along its whole length. */
  covered: boolean;
  verifiedAt: string;
  source: string;
}

export type PlaceCategory = 'cafe' | 'seating' | 'landmark' | 'waypoint';

export interface OpenWindow {
  /** 0 = Sunday … 6 = Saturday, in the dataset timezone. */
  day: number;
  start: string; // HH:MM
  end: string; // HH:MM
}

export interface Place {
  id: string;
  name: string;
  nodeId: string;
  category: PlaceCategory;
  dwellDefaultMin: number;
  spendLowInr: number | null;
  spendHighInr: number | null;
  tags: string[];
  verifiedOpenWindows: OpenWindow[];
  /**
   * verified: only open inside verifiedOpenWindows.
   * always: open public space, usable whenever the pilot window is.
   * unknown: never scheduled until checked.
   */
  hoursStatus: 'verified' | 'always' | 'unknown';
  /**
   * Where hours and prices came from. Anything other than 'survey' produces a
   * plan warning, and production validation rejects 'placeholder'.
   * Missing means 'survey'.
   */
  hoursSource?: DataSource;
  spendSource?: DataSource;
  verifiedAt: string;
  source: string;
}

export type DataSource = 'survey' | 'osm' | 'placeholder';

export interface CuratedStop {
  placeId: string;
  /** Number of walk edges completed before arriving at this stop. */
  afterEdge: number;
}

export interface CuratedWalk {
  id: string;
  name: string;
  startNodeId: string;
  edgeIds: string[];
  stops: CuratedStop[];
  tags: string[];
  verifiedAt: string;
}

export interface StartPoint {
  id: string;
  name: string;
  nodeId: string;
}

export interface Dataset {
  datasetVersion: string;
  /** Planning assumes a fixed +05:30 offset, so only Asia/Kolkata is supported. */
  timezone: 'Asia/Kolkata';
  /** True for made-up development data. Production checks refuse it. */
  isFixture: boolean;
  /** Reference point for sunrise and sunset. */
  location: { lat: number; lng: number };
  /** Daily window in which every included edge has been checked as usable. */
  supportedWindow: { start: string; end: string };
  licence: string;
  sources: string[];
  starts: StartPoint[];
  nodes: GraphNode[];
  edges: Edge[];
  places: Place[];
  curatedWalks: CuratedWalk[];
}

export type Occasion = 'date' | 'friends' | 'catchup' | 'meeting' | 'guest' | 'solo' | 'study_break' | 'active';
export type Pace = 'relaxed' | 'normal';

export interface PlanRequest {
  startId: string;
  durationMin: number;
  budgetInr: number;
  occasion: Occasion;
  /** Up to two must-visit places. */
  requiredPlaceIds: string[];
  requireCafe: boolean;
  pace: Pace;
  /** Per-place dwell overrides in minutes. */
  dwellOverridesMin?: Record<string, number>;
  /** Optional "back by" clock time today (HH:MM, IST), e.g. a hostel in-time. */
  backBy?: string;
  avoidSteps: boolean;
  rain: boolean;
  bufferMin?: number;
}

export interface Visit {
  placeId: string;
  name: string;
  category: PlaceCategory;
  arriveOffsetSec: number;
  /** Number of walk edges completed at arrival. Optional for older saved plans. */
  afterEdge?: number;
  dwellSec: number;
  spendLowInr: number;
  spendHighInr: number;
}

export interface Plan {
  /** Deterministic: g:<placeIds> for generated outings, c:<walkId> for curated walks. */
  id: string;
  kind: 'generated' | 'curated';
  name: string;
  /** Why it suits the chosen occasion; may be empty. */
  fit: string;
  explanation: string;
  startNodeId: string;
  edgeIds: string[];
  visits: Visit[];
  walkingSec: number;
  dwellSec: number;
  bufferSec: number;
  totalSec: number;
  /** Time the plan had to fit into (duration, back-by, sunset or pilot window, whichever is tightest). */
  availableSec: number;
  distanceM: number;
  spendLowInr: number;
  spendHighInr: number;
  /** Share of walking distance on covered edges, 0–1. */
  coveredShare: number;
  /** Share of walking distance on segments walked more than once, 0–1. */
  retraceRatio: number;
  outAndBack: boolean;
  usesSteps: boolean;
  /** Oldest verification date among the edges and places this plan relies on. */
  dataCheckedOn: string;
  warnings: string[];
}

export type BlockerCode =
  | 'UNKNOWN_START'
  | 'INVALID_INPUT'
  | 'OUTSIDE_WINDOW'
  | 'AFTER_SUNSET'
  | 'BEFORE_SUNRISE'
  | 'BACK_BY_PASSED'
  | 'TOO_MANY_REQUIRED'
  | 'REQUIRED_UNAVAILABLE'
  | 'NO_CAFE'
  | 'NOT_ENOUGH_TIME'
  | 'OVER_BUDGET'
  | 'TIME_AND_BUDGET'
  | 'NOTHING_FITS'
  | 'PLAN_OUTDATED';

export interface Blocker {
  code: BlockerCode;
  message: string;
  /** Only set when the planner actually calculated it. */
  minNeededMin?: number;
  minSpendInr?: number;
}

export type DeadlineReason = 'duration' | 'backBy' | 'sunset' | 'window';

export interface PlanContext {
  nowIst: string;
  sunsetIst: string;
  deadlineIst: string;
  deadlineReason: DeadlineReason;
  availableSec: number;
}

export interface PlanResult {
  plans: Plan[];
  blockers: Blocker[];
  context: PlanContext | null;
}
