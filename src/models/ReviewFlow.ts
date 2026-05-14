import type { MistakeStatus, ReviewResult } from '@/src/models/Mistake';

export interface ReviewSession {
  mistakeId: string;
  currentReviewCount: number;
  nextReviewIndex: number;
  maxReviewCount: number;
  status: MistakeStatus;
  canReview: boolean;
  reason?: string;
  nextReviewAt?: string | null;
  isFinalReview: boolean;
}

export interface CompleteReviewInput {
  mistakeId: string;
  reviewIndex: number;
  solutionImageUri: string;
  result?: ReviewResult;
  cleanupImageOnFailure?: boolean;
}

export interface CompleteReviewResult {
  ok: boolean;
  mistakeId?: string;
  reviewIndex?: number;
  newReviewCount?: number;
  newStatus?: MistakeStatus;
  nextReviewAt?: string | null;
  errorMessage?: string;
}
