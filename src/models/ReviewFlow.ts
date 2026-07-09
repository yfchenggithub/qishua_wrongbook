import type { MistakeStatus, ReviewResult } from '@/src/models/Mistake';
import type { ReviewRecordVoiceNote } from '@/src/models/ReviewRecord';

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
  solutionImageUri?: string | null;
  note?: string | null;
  voiceNote?: ReviewRecordVoiceNote | null;
  result: ReviewResult;
  cleanupImageOnFailure?: boolean;
}

export interface CompleteReviewResult {
  ok: boolean;
  mistakeId?: string;
  reviewRecordId?: string;
  reviewIndex?: number;
  newReviewCount?: number;
  newStatus?: MistakeStatus;
  nextReviewAt?: string | null;
  warningMessage?: string;
  errorMessage?: string;
}
