export function normalizeReviewPlanMistakeIds(values: readonly unknown[]): string[] {
  const normalizedIds: string[] = [];
  const seenIds = new Set<string>();

  for (const value of values) {
    const mistakeId = typeof value === 'string' ? value.trim() : '';
    if (!mistakeId || seenIds.has(mistakeId)) {
      continue;
    }
    normalizedIds.push(mistakeId);
    seenIds.add(mistakeId);
  }

  return normalizedIds;
}
