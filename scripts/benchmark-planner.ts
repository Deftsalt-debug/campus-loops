import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { OCCASION_IDS, OCCASIONS } from '../src/core/planner/occasions';
import { plan } from '../src/core/planner/plan';
import type { Dataset, PlanRequest } from '../src/core/types';
import demo from '../src/data/manipal-demo.json';

// Repeatable campus workload. The digest detects changes to routes, timings,
// rankings and blockers while comparing performance on the same machine.
const dataset = demo as unknown as Dataset;
const now = new Date('2026-10-01T10:00:00+05:30');
const requests: PlanRequest[] = dataset.starts.flatMap((start) =>
  OCCASION_IDS.flatMap((occasion) => [false, true].map((rain) => ({
    startId: start.id, occasion, ...OCCASIONS[occasion].defaults,
    requiredPlaceIds: [], avoidSteps: rain, rain,
  }))),
);
for (const request of requests) plan(dataset, request, now);
const durations: number[] = [];
const digest = createHash('sha256');
for (let round = 0; round < 3; round++) {
  for (const request of requests) {
    const start = performance.now();
    const result = plan(dataset, request, now);
    durations.push(performance.now() - start);
    if (round === 0) digest.update(JSON.stringify(result));
  }
}
durations.sort((a, b) => a - b);
console.log(JSON.stringify({
  requests: requests.length, samples: durations.length,
  medianMs: +durations[Math.floor(durations.length * 0.5)].toFixed(2),
  p95Ms: +durations[Math.floor(durations.length * 0.95)].toFixed(2),
  maxMs: +durations.at(-1)!.toFixed(2),
  totalMs: +durations.reduce((a, b) => a + b, 0).toFixed(2),
  resultDigest: digest.digest('hex'),
}, null, 2));
