// Check a dataset file and print a report.
// Usage: npm run data:check [-- path/to/dataset.json] [-- --production]
// Exits with 1 when there are errors. --production also rejects fixture data.

import { readFileSync } from 'node:fs';
import { validateDataset } from '../src/core/dataset/validate';
import type { Dataset } from '../src/core/types';

const args = process.argv.slice(2);
const production = args.includes('--production');
const file = args.find((a) => !a.startsWith('--')) ?? 'src/data/manipal-demo.json';

let data: Dataset;
try {
  data = JSON.parse(readFileSync(file, 'utf8')) as Dataset;
} catch (err) {
  console.error(`Could not read ${file}: ${(err as Error).message}`);
  process.exit(1);
}

const issues = validateDataset(data, { production });
const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.filter((i) => i.level === 'warning');

console.log(`${file} (${data.datasetVersion ?? 'no version'})`);
console.log(
  `  ${data.nodes?.length ?? 0} nodes, ${data.edges?.length ?? 0} arcs, ${data.places?.length ?? 0} places, ` +
    `${data.curatedWalks?.length ?? 0} curated walks, ${data.starts?.length ?? 0} starts`,
);
for (const i of errors) console.log(`  ERROR   ${i.code.padEnd(18)} ${i.message}`);
for (const i of warnings) console.log(`  warning ${i.code.padEnd(18)} ${i.message}`);
console.log(`${errors.length} error(s), ${warnings.length} warning(s)${production ? ' [production mode]' : ''}`);
process.exit(errors.length ? 1 : 0);
