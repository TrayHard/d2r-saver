/**
 * Convert a string value to a number, returning undefined for empty/invalid values.
 */
export function toNumber(v: string | undefined | null): number | undefined {
  if (v === undefined || v === null || v === '') {
    return undefined;
  }
  const trimmed = v.trim();
  if (trimmed === '') return undefined;
  return isNaN(Number(trimmed)) ? undefined : Number(trimmed);
}
