# Architecture

Campus Loops is a static browser application. Planning runs locally on saved campus data; map providers supply backgrounds and optional venue details.

## Modules

| Location | Responsibility |
| --- | --- |
| `src/core/routing/` | Dijkstra, binary heap and path reconstruction |
| `src/core/graph/` | Graph construction and edge costs |
| `src/core/planner/` | Candidate filtering, bounded search, ranking, diversity and explanations |
| `src/core/time/` | Clock and sunset constraints |
| `src/core/share.ts`, `src/core/export/` | Validated links and itinerary exports |
| `src/core/companion.ts` | Walk timing and return estimates |
| `src/ui/`, `src/ui/google/` | Outing workflow, map interaction and optional Google integration |
| `src/storage/` | Browser-local saved plans, calibration and field notes |
| `scripts/import-osm.ts`, `scripts/osm-rules.ts` | Reproducible saved-data import |

## Planning flow

1. Validate the request, its selected starts/stops, available time and data version.
2. Build a walkable graph from supported access records and apply pace/edge costs.
3. Filter candidate stops by occasion, budget, hours and requested conditions.
4. Search stop orders with shortest-path lower bounds; required stops and hard limits remain mandatory.
5. Consider a less-retracing return route where its detour is acceptable under the same limits.
6. Rank fitting itineraries and remove near-duplicates; return fewer than three if necessary.
7. When none fit, calculate an explanation without silently relaxing the user's constraints.

Dijkstra, its binary heap and edge costs are deliberately implemented in this repository. Tests exercise path correctness and planner invariants.
Tunable planner assumptions live in `src/core/planner/config.ts`. A supported estimate is not proof of real-world access or safety.

## Interface and map providers

The main flow is describe the outing, choose a walk, then head out. Map pins and itinerary stops refer to the same selection.
The default MapLibre map uses OpenFreeMap resources; provider failure exposes retry/navigation alternatives.
Google Maps is optional. Its venue search and current details do not replace the saved walking graph; reachable live places must be near a saved path.
A rejected Google key falls back to the default map. Google browser keys are public build inputs and need website/API restrictions.
Per-page request guards reduce accidental usage but are not billing limits.

## Storage and sharing

Share links carry request/route identity in their URL fragment. Reopening rechecks the identified route against current time and dataset version.
A route that no longer fits is rejected rather than replaced. Saved plans, field notes and calibration logs live in browser storage.
Backup/import validates entries and does not silently update their original dataset versions.
Field notes and measured times do not automatically change planning data or parameters.
The walk companion uses device-clock deadlines and persisted session state; estimates update when arrival/departure or delays are recorded.

## External boundaries

No application backend, account system or cloud route database receives visitor input.
Map resources, optional Google venue requests and opened navigation links do contact their respective providers.
Provider responses can fail, data can be stale and browser storage can be blocked or cleared. UI failure states and data notes remain part of the product contract.
See [data provenance](DATA_PROVENANCE.md) for source dates, attribution and field-verification requirements.

## Build and deployment

Vite emits static files with relative asset URLs. Shared routes use fragments, so a server-side routing fallback is unnecessary.
The single workflow verifies pushes/PRs and deploys only `main` to GitHub Pages; only its deploy job receives Pages/OIDC write permissions.
`scripts/verify-deployment.mjs` creates a release manifest and verifies the published commit and asset checksums.
`vercel.json` is retained as an alternative configuration until the maintainer confirms whether an independent mirror exists.

The TypeScript solution separates browser code, Node build configuration and test/tool checking.
The base Playwright configuration checks real maps at root and Pages paths; the Google configuration extends it for a placeholder-key build and local API stub.
They are different test targets, not duplicate unused configuration.
