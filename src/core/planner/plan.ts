import { buildGraph } from '../graph/buildGraph';
import type { CostModel } from '../graph/edgeCost';
import { formatMinutes, isHHMM, IST_OFFSET_MIN, parseHHMM, toIst } from '../time/clock';
import { sunTimes } from '../time/sun';
import type { Blocker, Dataset, DeadlineReason, Place, PlanContext, PlanRequest, PlanResult } from '../types';
import { placeIneligibility, selectCandidates, type Ineligibility } from './candidates';
import { DEFAULT_CONFIG, type PlannerConfig } from './config';
import { createRequestContext, type Itinerary, type Limits, type RequestContext } from './context';
import { evaluateCurated } from './curated';
import { pickDiverse } from './diversity';
import { pathMetrics, scoreParts, toPlan } from './explain';
import { isOccasion, OCCASIONS } from './occasions';
import { compareScores } from './score';
import { searchGenerated } from './search';

/**
 * Plan up to three genuinely different outings.
 *
 * Pure and deterministic: the same dataset, request and `now` always give the
 * same result. Hard limits (time, budget, required stops, access) are never
 * relaxed; when nothing fits, the planner re-runs with one limit lifted only
 * to *report* what the user would need to change.
 */
export function plan(
  dataset: Dataset,
  request: PlanRequest,
  now: Date,
  config: PlannerConfig = DEFAULT_CONFIG,
): PlanResult {
  return run(dataset, request, now, config, null);
}

/**
 * Re-check one specific plan (e.g. from a shared link) against the current
 * time and data. Returns that exact plan if it is still feasible, otherwise a
 * PLAN_OUTDATED blocker. It never silently substitutes a different route.
 */
export function rebuildPlan(
  dataset: Dataset,
  request: PlanRequest,
  now: Date,
  planId: string,
  config: PlannerConfig = DEFAULT_CONFIG,
): PlanResult {
  return run(dataset, request, now, config, planId);
}

function run(
  dataset: Dataset,
  request: PlanRequest,
  now: Date,
  config: PlannerConfig,
  onlyPlanId: string | null,
): PlanResult {
  const fail = (blocker: Blocker, context: PlanContext | null = null): PlanResult => ({
    plans: [],
    blockers: [blocker],
    context,
  });

  if (!Number.isFinite(now.getTime())) return fail({ code: 'INVALID_INPUT', message: 'Choose a valid planning time.' });
  const inputError = validateRequest(dataset, request, config);
  if (inputError) return fail({ code: 'INVALID_INPUT', message: inputError });

  const start = dataset.starts.find((s) => s.id === request.startId);
  if (!start) return fail({ code: 'UNKNOWN_START', message: 'Choose a starting point from the list.' });

  // ---- When must the outing end? ----
  const ist = toIst(now);
  const nowSec = ist.secondOfDay;
  const sun = sunTimes(ist.year, ist.month, ist.day, dataset.location.lat, dataset.location.lng, IST_OFFSET_MIN);
  if (!sun) return fail({ code: 'NOTHING_FITS', message: 'Could not work out daylight hours for this location.' });
  const sunriseSec = Math.ceil(sun.sunriseMin * 60);
  const sunsetSec = Math.floor(sun.sunsetMin * 60);
  const windowStartSec = parseHHMM(dataset.supportedWindow.start) * 60;
  const windowEndSec = parseHHMM(dataset.supportedWindow.end) * 60;
  const sunsetIst = formatMinutes(sunsetSec / 60);
  const nowIst = formatMinutes(nowSec / 60);

  const deadlines: [DeadlineReason, number][] = [
    ['duration', request.durationMin * 60],
    ...(request.backBy ? ([['backBy', parseHHMM(request.backBy) * 60 - nowSec]] as [DeadlineReason, number][]) : []),
    ['sunset', sunsetSec - nowSec],
    ['window', windowEndSec - nowSec],
  ];
  // Tightest wins; on a tie the earlier entry (the user's own choice) is reported.
  const [deadlineReason, availableSec] = deadlines.reduce((best, d) => (d[1] < best[1] ? d : best));
  const context: PlanContext = {
    nowIst,
    sunsetIst,
    deadlineIst: formatMinutes((nowSec + Math.max(0, availableSec)) / 60),
    deadlineReason,
    availableSec: Math.max(0, availableSec),
  };

  const pilotHours = `${dataset.supportedWindow.start}–${dataset.supportedWindow.end}`;
  if (nowSec < windowStartSec || nowSec >= windowEndSec) {
    return fail({ code: 'OUTSIDE_WINDOW', message: `The pilot only covers outings between ${pilotHours} IST. It is ${nowIst} now.` }, context);
  }
  if (nowSec < sunriseSec) {
    return fail({ code: 'BEFORE_SUNRISE', message: `Daylight outings only: sunrise today is at ${formatMinutes(sunriseSec / 60)}.` }, context);
  }
  if (nowSec >= sunsetSec) {
    return fail({ code: 'AFTER_SUNSET', message: `Daylight outings only: sunset today was at ${sunsetIst}.` }, context);
  }
  if (request.backBy && parseHHMM(request.backBy) * 60 <= nowSec) {
    return fail({ code: 'BACK_BY_PASSED', message: `${request.backBy} has already passed today. Choose a later back-by time.` }, context);
  }

  // ---- Required stops must fit the stop cap ----
  const places = new Map(dataset.places.map((p) => [p.id, p]));
  const required = request.requiredPlaceIds.map((id) => places.get(id)!);
  const needsExtraCafe = request.requireCafe && !required.some((p) => p.category === 'cafe');
  const profile = OCCASIONS[request.occasion];
  const maxStops = Math.min(config.maxStops, profile.maxStops ?? Infinity);
  if (required.length + (needsExtraCafe ? 1 : 0) > maxStops) {
    return fail({
      code: 'TOO_MANY_REQUIRED',
      message: `${profile.label} plans have at most ${maxStops} stop${maxStops === 1 ? '' : 's'}. Remove a required stop or the café requirement.`,
    }, context);
  }

  // ---- Routing state for this request ----
  const graph = buildGraph(dataset, { avoidSteps: request.avoidSteps });
  const model: CostModel = {
    paceMps: config.paceMps[request.pace],
    climbSecPerM: config.climbSecPerM,
    rain: request.rain,
    rainUncoveredMultiplier: config.rainUncoveredMultiplier,
  };
  const overrides = request.dwellOverridesMin ?? {};
  const ctx = createRequestContext({
    graph,
    model,
    startNode: start.nodeId,
    weekday: ist.weekday,
    nowSec,
    bufferSec: (request.bufferMin ?? config.defaultBufferMin) * 60,
    requiredIds: new Set(request.requiredPlaceIds),
    requireCafe: request.requireCafe,
    avoidSteps: request.avoidSteps,
    maxStops,
    dwellSec: (p: Place) => (Object.hasOwn(overrides, p.id) ? overrides[p.id] : p.dwellDefaultMin) * 60,
  }, { reuseFactor: config.loopReuseFactor, maxDetour: config.loopMaxDetour });

  for (const p of required) {
    const reason = placeIneligibility(p, ctx, Infinity, false);
    if (reason) {
      return fail({ code: 'REQUIRED_UNAVAILABLE', message: requiredMessage(p, reason, request.avoidSteps) }, context);
    }
  }

  // ---- Search under the real limits ----
  const limits: Limits = { availableSec: context.availableSec, budgetInr: request.budgetInr };
  const found = findItineraries(dataset, places, ctx, request, limits, config, onlyPlanId);

  if (found.length > 0) {
    const ranked = found
      .map((it) => {
        const m = pathMetrics(it);
        const stopKey = it.visits.map((v) => v.place.id).sort().join('.') || it.id;
        return { it, m, stopKey, segmentIds: m.segmentIds, score: scoreParts(it, m, request.occasion, request.rain, limits.availableSec) };
      })
      .sort((a, b) => compareScores(a.score, b.score));
    const chosen = onlyPlanId !== null
      ? ranked.filter((r) => r.it.id === onlyPlanId)
      : pickDiverse(ranked, config.maxResults, config.duplicateOverlap);
    const plans = chosen.map(({ it, m }) =>
      toPlan(it, m, ctx, {
        availableSec: limits.availableSec,
        rain: request.rain,
        now,
        staleAfterDays: config.staleAfterDays,
        outAndBackRetrace: config.outAndBackRetrace,
        occasion: request.occasion,
      }),
    );
    if (plans.length > 0 || onlyPlanId === null) return { plans, blockers: [], context };
  }
  if (onlyPlanId !== null) {
    return fail({
      code: 'PLAN_OUTDATED',
      message: 'This shared plan no longer fits right now (time, opening hours or data changed). Plan again to get a fresh route.',
    }, context);
  }

  return fail(diagnose(dataset, places, ctx, request, limits, config, context), context);
}

function findItineraries(
  dataset: Dataset,
  places: Map<string, Place>,
  ctx: RequestContext,
  request: PlanRequest,
  limits: Limits,
  config: PlannerConfig,
  onlyPlanId: string | null = null,
  loops = true,
): Itinerary[] {
  const candidates = selectCandidates(dataset.places, ctx, {
    budgetInr: limits.budgetInr,
    availableSec: limits.availableSec,
    rain: request.rain,
    occasion: request.occasion,
    // A saved route is checked for feasibility, independent of which other
    // stops happen to rank in the recommendation shortlist right now.
    maxCandidates: onlyPlanId !== null ? dataset.places.length : config.maxCandidates,
    cafesKeptWhenRequired: config.cafesKeptWhenRequired,
    minStopRoundTripSec: config.minStopRoundTripSec,
  });
  const isGenerated = onlyPlanId === null || onlyPlanId.startsWith('g:') || onlyPlanId.startsWith('l:');
  const generated = isGenerated
    ? searchGenerated(ctx, candidates, limits, { onlyPlanId: onlyPlanId ?? undefined, loops }).itineraries
    : [];
  const curated = dataset.curatedWalks
    .filter((w) => onlyPlanId === null || `c:${w.id}` === onlyPlanId)
    .map((w) => evaluateCurated(w, places, ctx, limits, request.rain))
    .flatMap((o) => (o.ok ? [o.itinerary] : []));
  return [...generated, ...curated];
}

/**
 * Explain why nothing fits by lifting one limit at a time. The relaxed
 * results are never shown as plans; they only supply honest numbers.
 */
function diagnose(
  dataset: Dataset,
  places: Map<string, Place>,
  ctx: RequestContext,
  request: PlanRequest,
  limits: Limits,
  config: PlannerConfig,
  context: PlanContext,
): Blocker {
  // Minimums only need the quickest way home, so skip loop variants here.
  const run = (l: Limits) => findItineraries(dataset, places, ctx, request, l, config, null, false);
  const availableMin = Math.floor(limits.availableSec / 60);
  const deadlineText: Record<DeadlineReason, string> = {
    duration: `${request.durationMin} minutes`,
    backBy: `the ${availableMin} minutes until your back-by time (${request.backBy})`,
    sunset: `the ${availableMin} minutes of daylight left (sunset ${context.sunsetIst})`,
    window: `the ${availableMin} minutes left in the pilot's hours`,
  };
  const withHints = (message: string, hints: string[]) =>
    hints.length ? `${message} ${hints.join(' or ').replace(/^./, (c) => c.toUpperCase())}.` : message;
  const cafeHints = request.requireCafe ? ['remove the café requirement'] : [];

  const noTime = run({ ...limits, availableSec: Infinity });
  if (noTime.length > 0) {
    const minNeededMin = Math.ceil(Math.min(...noTime.map((it) => it.totalSec)) / 60);
    const timeHints: string[] = [];
    if (context.deadlineReason === 'duration' && minNeededMin <= config.maxDurationMin) timeHints.push(`try ${minNeededMin} minutes`);
    if (context.deadlineReason === 'backBy') timeHints.push('set a later back-by time');
    if (request.requiredPlaceIds.length > 0) timeHints.push('drop a must-visit place');
    return {
      code: 'NOT_ENOUGH_TIME',
      message: withHints(
        `Nothing fits in ${deadlineText[context.deadlineReason]}. The shortest suitable plan found needs ${minNeededMin} minutes, including the buffer.`,
        [...timeHints, ...cafeHints],
      ),
      minNeededMin,
    };
  }

  const noBudget = run({ ...limits, budgetInr: Infinity });
  if (noBudget.length > 0) {
    const minSpendInr = Math.min(...noBudget.map((it) => it.spendHighInr));
    return {
      code: 'OVER_BUDGET',
      message: withHints(
        `Nothing fits within ₹${request.budgetInr} per person. The cheapest suitable plan found is estimated at up to ₹${minSpendInr}.`,
        [`raise the budget to ₹${minSpendInr}`, ...cafeHints],
      ),
      minSpendInr,
    };
  }

  const neither = run({ availableSec: Infinity, budgetInr: Infinity });
  if (neither.length > 0) {
    const minNeededMin = Math.ceil(Math.min(...neither.map((it) => it.totalSec)) / 60);
    const minSpendInr = Math.min(...neither.map((it) => it.spendHighInr));
    return {
      code: 'TIME_AND_BUDGET',
      message: `Both time and budget are too tight. Suitable plans need at least ${minNeededMin} minutes and up to ₹${minSpendInr} per person.`,
      minNeededMin,
      minSpendInr,
    };
  }

  // Lifting time and budget didn't help, so opening hours are what's left.
  const timedRequired = request.requiredPlaceIds.map((id) => places.get(id)!).find((p) => p.hoursStatus === 'verified');
  if (timedRequired) {
    return {
      code: 'REQUIRED_UNAVAILABLE',
      message: `${timedRequired.name} isn't open long enough today for a visit that starts now. Remove it or try earlier in its opening hours.`,
    };
  }
  if (request.requireCafe) {
    return {
      code: 'NO_CAFE',
      message: 'No verified café is open and reachable from this start right now. Remove the café requirement or try another start.',
    };
  }
  return {
    code: 'NOTHING_FITS',
    message: 'No verified route fits these choices right now. Try another start or fewer required stops.',
  };
}

function requiredMessage(place: Place, reason: Ineligibility, avoidSteps: boolean): string {
  switch (reason) {
    case 'UNKNOWN_HOURS':
      return `${place.name} can't be scheduled yet: its opening hours haven't been verified.`;
    case 'UNKNOWN_PRICE':
      return `${place.name} can't be scheduled yet: its prices haven't been checked.`;
    case 'CLOSED_TODAY':
      return `${place.name} is not open today.`;
    case 'UNREACHABLE':
      return avoidSteps
        ? `${place.name} can't be reached and left without steps from this start.`
        : `${place.name} can't be reached from this start on verified paths.`;
    default:
      return `${place.name} can't be scheduled.`;
  }
}

function validateRequest(dataset: Dataset, r: PlanRequest, config: PlannerConfig): string | null {
  if (!isOccasion(r.occasion)) return 'Choose an occasion.';
  if (!['relaxed', 'normal'].includes(r.pace)) return 'Choose a pace.';
  if (!Number.isFinite(r.durationMin) || r.durationMin < config.minDurationMin || r.durationMin > config.maxDurationMin) {
    return `Time available must be between ${config.minDurationMin} and ${config.maxDurationMin} minutes.`;
  }
  if (!Number.isFinite(r.budgetInr) || r.budgetInr < 0) return 'Budget must be ₹0 or more.';
  if (r.requiredPlaceIds.length > config.maxRequired) return `Choose at most ${config.maxRequired} must-visit places.`;
  if (new Set(r.requiredPlaceIds).size !== r.requiredPlaceIds.length) return 'A must-visit place is listed twice.';
  const ids = new Set(dataset.places.map((p) => p.id));
  if (r.requiredPlaceIds.some((id) => !ids.has(id))) return 'A must-visit place is not in this dataset.';
  if (r.backBy !== undefined && !isHHMM(r.backBy)) return 'Back-by time must look like 18:30.';
  if (r.bufferMin !== undefined && (!Number.isFinite(r.bufferMin) || r.bufferMin < 0 || r.bufferMin > 30)) {
    return 'Buffer must be between 0 and 30 minutes.';
  }
  for (const [id, min] of Object.entries(r.dwellOverridesMin ?? {})) {
    if (!ids.has(id)) return 'A stop-time change refers to an unknown place.';
    if (!Number.isFinite(min) || min < 0 || min > config.maxDwellMin) {
      return `Stop time must be between 0 and ${config.maxDwellMin} minutes.`;
    }
  }
  return null;
}
