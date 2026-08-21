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

export interface ReviewPlanScheduleItem {
  mistakeId: string;
  nextReviewAt: string;
  dayOffset: number;
}

export function buildDailyReviewPlanSchedule(
  values: readonly unknown[],
  startAt: Date,
  dailyLimit: number,
): ReviewPlanScheduleItem[] {
  const normalizedDailyLimit = Math.floor(dailyLimit);
  if (!Number.isFinite(normalizedDailyLimit) || normalizedDailyLimit <= 0) {
    throw new Error('dailyLimit must be a positive integer.');
  }
  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) {
    throw new Error('startAt must be a valid Date.');
  }

  return normalizeReviewPlanMistakeIds(values).map((mistakeId, index) => {
    const dayOffset = Math.floor(index / normalizedDailyLimit);
    const nextReviewDate = new Date(startAt.getTime());
    nextReviewDate.setDate(nextReviewDate.getDate() + dayOffset);
    return {
      mistakeId,
      nextReviewAt: nextReviewDate.toISOString(),
      dayOffset,
    };
  });
}
