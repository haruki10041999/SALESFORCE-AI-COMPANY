export function normalizeSampleLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value ?? fallback)) : fallback;
}
