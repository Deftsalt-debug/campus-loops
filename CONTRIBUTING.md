# Contributing

Use a focused branch, run `npm ci` and `npm run verify`, and describe the observed problem and validation in your pull request.
Preserve the hand-written routing algorithm, binary heap, edge costs and their tests. Changes to those require their own explicit review.
Keep source dates, OSM attribution and demo assumptions visible. Never present a map refresh or structural test as a field survey.
For UI/provider changes, run both browser suites; see [local development](docs/LOCAL_DEVELOPMENT.md).

## Security reports

Use [Security → Report a vulnerability](https://github.com/Deftsalt-debug/campus-loops/security) when available.
If private reporting is unavailable, open a public issue asking for a private channel without exploit details or personal route exports.
Include the affected commit, browser, reproduction and impact. Do not post secrets or unredacted walking logs.
Dependency updates and pinned GitHub Actions still require review; a clean audit is not proof of safety.
