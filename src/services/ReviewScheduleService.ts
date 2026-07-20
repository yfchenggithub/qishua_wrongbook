import { MAX_REVIEW_COUNT, REVIEW_INTERVAL_DAYS, REVIEW_STATUS } from '@/src/constants/review';
import type { MistakeStatus } from '@/src/models/Mistake';
import { addDays, toDateOnlyString } from '@/src/utils/date';

export interface CanStartReviewParams {
  status: MistakeStatus;
  reviewCount: number;
}

export interface CanStartReviewResult {
  canReview: boolean;
  reason?: string;
}

function normalizeReviewCount(reviewCount: number): number {
  if (!Number.isFinite(reviewCount)) {
    return 0;
  }
  return Math.max(0, Math.floor(reviewCount));
}

export function getNextReviewIndex(reviewCount: number): number {
  const normalized = normalizeReviewCount(reviewCount);
  return Math.min(MAX_REVIEW_COUNT, normalized + 1);
}

export function canStartReview(params: CanStartReviewParams): CanStartReviewResult {
  if (params.status === REVIEW_STATUS.COLLECTED) {
    return {
      canReview: false,
      reason: '尚未加入七刷',
    };
  }

  if (params.status === REVIEW_STATUS.MASTERED) {
    return {
      canReview: false,
      reason: '已完成七刷',
    };
  }

  if (params.status === REVIEW_STATUS.ARCHIVED) {
    return {
      canReview: false,
      reason: '已归档',
    };
  }

  if (normalizeReviewCount(params.reviewCount) >= MAX_REVIEW_COUNT) {
    return {
      canReview: false,
      reason: '已达到最大复做次数',
    };
  }

  return {
    canReview: true,
  };
}

export function calculateNextReviewAt(newReviewCount: number, baseDate?: Date): string | null {
  const normalizedCount = normalizeReviewCount(newReviewCount);
  if (normalizedCount >= MAX_REVIEW_COUNT) {
    return null;
  }

  const intervalDays = REVIEW_INTERVAL_DAYS[normalizedCount];
  if (typeof intervalDays !== 'number') {
    throw new Error(`Missing REVIEW_INTERVAL_DAYS config for review_count=${normalizedCount}.`);
  }

  const referenceDate = baseDate ?? new Date();
  return toDateOnlyString(addDays(referenceDate, intervalDays));
}

export function getReviewStatusAfterComplete(newReviewCount: number): 'active' | 'mastered' {
  return normalizeReviewCount(newReviewCount) >= MAX_REVIEW_COUNT
    ? REVIEW_STATUS.MASTERED
    : REVIEW_STATUS.ACTIVE;
}

export function isFinalReview(reviewIndex: number): boolean {
  return normalizeReviewCount(reviewIndex) >= MAX_REVIEW_COUNT;
}
