import type { Dataset } from '../types';
import { validateDataset, type Issue, type ValidateOptions } from './validate';

export class DatasetError extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super(`Dataset has ${issues.filter((i) => i.level === 'error').length} error(s): ${issues.find((i) => i.level === 'error')?.message}`);
    this.issues = issues;
  }
}

/** Validate parsed JSON and return it typed. Throws DatasetError rather than planning on bad data. */
export function loadDataset(json: unknown, options: ValidateOptions = {}): { dataset: Dataset; issues: Issue[] } {
  if (typeof json !== 'object' || json === null) throw new DatasetError([{ level: 'error', code: 'SHAPE', message: 'Dataset must be an object.' }]);
  const dataset = json as Dataset;
  const issues = validateDataset(dataset, options);
  if (issues.some((i) => i.level === 'error')) throw new DatasetError(issues);
  return { dataset, issues };
}
