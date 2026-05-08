import { MAX_REVIEW_COUNT } from '@/src/constants/review';
import type { MistakeDetailViewModel } from '@/src/models/MistakeDetailViewModel';
import type { ReviewSession } from '@/src/models/ReviewFlow';
import { Logger } from '@/src/services/Logger';
import * as MistakeDetailService from '@/src/services/MistakeDetailService';
import {
  canStartReview,
  getNextReviewIndex,
  isFinalReview,
} from '@/src/services/ReviewScheduleService';

const SERVICE_SCOPE = 'ReviewFlowService';
const FALLBACK_ERROR_MESSAGE = '读取复做任务失败，请稍后重试。';

export interface ReviewPageData {
  detail: MistakeDetailViewModel;
  session: ReviewSession;
}

export type GetReviewPageDataResult = {
  ok: boolean;
  data?: ReviewPageData;
  errorMessage?: string;
  notFound?: boolean;
};

function normalizeMistakeId(id: string): string {
  return typeof id === 'string' ? id.trim() : '';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : FALLBACK_ERROR_MESSAGE;
  }

  const message = String(error ?? '').trim();
  return message.length > 0 ? message : FALLBACK_ERROR_MESSAGE;
}

function buildReviewSession(detail: MistakeDetailViewModel): ReviewSession {
  const nextReviewIndex = getNextReviewIndex(detail.reviewCount);
  const reviewPermission = canStartReview({
    status: detail.status,
    reviewCount: detail.reviewCount,
  });

  return {
    mistakeId: detail.id,
    currentReviewCount: detail.reviewCount,
    nextReviewIndex,
    maxReviewCount: MAX_REVIEW_COUNT,
    status: detail.status,
    canReview: reviewPermission.canReview,
    reason: reviewPermission.reason,
    nextReviewAt: detail.nextReviewAt ?? null,
    isFinalReview: isFinalReview(nextReviewIndex),
  };
}

export async function getReviewPageData(id: string): Promise<GetReviewPageDataResult> {
  const mistakeId = normalizeMistakeId(id);
  if (!mistakeId) {
    return {
      ok: false,
      errorMessage: '错题 id 不能为空。',
    };
  }

  try {
    const detailResult = await MistakeDetailService.getMistakeDetail(mistakeId);
    if (!detailResult.ok) {
      return {
        ok: false,
        notFound: detailResult.notFound === true,
        errorMessage: detailResult.errorMessage ?? FALLBACK_ERROR_MESSAGE,
      };
    }

    if (!detailResult.detail) {
      return {
        ok: false,
        errorMessage: FALLBACK_ERROR_MESSAGE,
      };
    }

    return {
      ok: true,
      data: {
        detail: detailResult.detail,
        session: buildReviewSession(detailResult.detail),
      },
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getReviewPageData failed.', { id: mistakeId, error });
    return {
      ok: false,
      errorMessage: toErrorMessage(error),
    };
  }
}
