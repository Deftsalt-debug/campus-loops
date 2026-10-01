/** Identifiers embedded in share links have a bounded, delimiter-safe alphabet. */
export const MAX_IDENTIFIER_LENGTH = 120;

export function isShareIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH && !/[^A-Za-z0-9_.:-]/.test(value);
}

/** Dots separate ordered places in generated plan IDs, so cannot name a place. */
export function isPlaceIdentifier(value: string): boolean {
  return isShareIdentifier(value) && !value.includes('.');
}
