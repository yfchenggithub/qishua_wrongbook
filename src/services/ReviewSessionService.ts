import type { ReviewResult } from '@/src/models/Mistake';
import type { ReviewRecordVoiceNote } from '@/src/models/ReviewRecord';
import type { ReviewPageData } from '@/src/services/ReviewFlowService';
import * as CompleteReviewService from '@/src/services/CompleteReviewService';
import { Logger } from '@/src/services/Logger';
import * as MistakeListService from '@/src/services/MistakeListService';
import * as ReviewFlowService from '@/src/services/ReviewFlowService';

const SERVICE_SCOPE = 'ReviewSessionService';
const FALLBACK_LOAD_ERROR = '读取复做题目失败，请稍后重试。';

export interface ReviewSessionQueueItem {
  id: string;
  title: string;
  module: string;
  nextReviewIndex: number;
  reviewCount: number;
  maxReviewCount: number;
}

export type LoadTodayReviewItemResult =
  | {
      ok: true;
      data: ReviewPageData;
    }
  | {
      ok: false;
      errorMessage: string;
      canSkip: boolean;
    };

function clampReviewIndex(reviewCount: number, maxReviewCount: number): number {
  const normalizedReviewCount = Number.isFinite(reviewCount) ? Math.max(0, Math.floor(reviewCount)) : 0;
  const normalizedMax = Number.isFinite(maxReviewCount) ? Math.max(1, Math.floor(maxReviewCount)) : 1;
  return Math.min(normalizedMax, normalizedReviewCount + 1);
}

function toErrorMessage(input?: string): string {
  const normalized = typeof input === 'string' ? input.trim() : '';
  return normalized.length > 0 ? normalized : FALLBACK_LOAD_ERROR;
}

export async function getTodayReviewSessionQueue(): Promise<ReviewSessionQueueItem[]> {
  try {
    const queue = await MistakeListService.getTodayReviewQueue();
    return queue.map((item) => ({
      id: item.id,
      title: item.title,
      module: item.module,
      reviewCount: item.reviewCount,
      maxReviewCount: item.maxReviewCount,
      nextReviewIndex: clampReviewIndex(item.reviewCount, item.maxReviewCount),
    }));
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to load today review session queue.', { error });
    throw error;
  }
}

export async function loadTodayReviewItem(mistakeId: string): Promise<LoadTodayReviewItemResult> {
  const normalizedId = typeof mistakeId === 'string' ? mistakeId.trim() : '';
  if (!normalizedId) {
    return {
      ok: false,
      errorMessage: '错题 id 无效。',
      canSkip: true,
    };
  }

  try {
    const result = await ReviewFlowService.getReviewPageData(normalizedId);
    if (!result.ok || !result.data) {
      return {
        ok: false,
        errorMessage: toErrorMessage(result.errorMessage),
        canSkip: result.notFound === true,
      };
    }

    if (!result.data.session.canReview) {
      return {
        ok: false,
        errorMessage: toErrorMessage(result.data.session.reason ?? '当前题目不可复做。'),
        canSkip: true,
      };
    }

    return {
      ok: true,
      data: result.data,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'loadTodayReviewItem failed unexpectedly.', {
      mistakeId: normalizedId,
      error,
    });
    return {
      ok: false,
      errorMessage: FALLBACK_LOAD_ERROR,
      canSkip: false,
    };
  }
}

export async function submitTodayReviewResult(input: {
  mistakeId: string;
  reviewIndex: number;
  result: ReviewResult;
  solutionImageUri?: string | null;
  voiceNote?: ReviewRecordVoiceNote | null;
}) {
  return CompleteReviewService.completeReview({
    mistakeId: input.mistakeId,
    reviewIndex: input.reviewIndex,
    result: input.result,
    solutionImageUri: input.solutionImageUri ?? null,
    voiceNote: input.voiceNote ?? null,
    cleanupImageOnFailure: false,
  });
}
