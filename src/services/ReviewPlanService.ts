import { MistakeRepository } from '@/src/repositories';
import { Logger } from '@/src/services/Logger';
import * as ReviewReminderService from '@/src/services/ReviewReminderService';
import { normalizeReviewPlanMistakeIds } from '@/src/utils/reviewPlan';

const SERVICE_SCOPE = 'ReviewPlanService';
const BULK_JOIN_ERROR_MESSAGE = '批量加入七刷失败，请稍后重试。';

export interface BulkJoinReviewPlanResult {
  ok: boolean;
  requestedCount: number;
  joinedCount: number;
  skippedCount: number;
  joinedAt?: string;
  errorMessage?: string;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : BULK_JOIN_ERROR_MESSAGE;
  }
  const message = String(error ?? '').trim();
  return message.length > 0 ? message : BULK_JOIN_ERROR_MESSAGE;
}

export async function bulkJoinMistakesReviewPlan(
  mistakeIdInputs: readonly unknown[],
): Promise<BulkJoinReviewPlanResult> {
  const mistakeIds = normalizeReviewPlanMistakeIds(mistakeIdInputs);
  const requestedCount = mistakeIds.length;
  if (requestedCount <= 0) {
    return {
      ok: false,
      requestedCount: 0,
      joinedCount: 0,
      skippedCount: 0,
      errorMessage: '没有可加入七刷的待整理题。',
    };
  }

  const joinedAt = new Date().toISOString();
  try {
    Logger.info(SERVICE_SCOPE, 'Start bulk joining mistakes to review plan.', {
      requestedCount,
    });
    const joinedCount = await MistakeRepository.joinMistakesReviewPlan(mistakeIds, joinedAt);
    const skippedCount = Math.max(0, requestedCount - joinedCount);

    if (joinedCount > 0) {
      void ReviewReminderService.refreshReminderSchedule({ reason: 'bulk_join_review_plan' }).catch(
        (error) => {
          Logger.warn(SERVICE_SCOPE, 'Reminder refresh failed after bulk joining review plan.', {
            joinedCount,
            error,
          });
        },
      );
    }

    Logger.info(SERVICE_SCOPE, 'Finished bulk joining mistakes to review plan.', {
      requestedCount,
      joinedCount,
      skippedCount,
      joinedAt,
    });
    return {
      ok: true,
      requestedCount,
      joinedCount,
      skippedCount,
      joinedAt,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'bulkJoinMistakesReviewPlan failed.', {
      requestedCount,
      error,
    });
    return {
      ok: false,
      requestedCount,
      joinedCount: 0,
      skippedCount: 0,
      errorMessage: toErrorMessage(error),
    };
  }
}

export const ReviewPlanService = {
  bulkJoinMistakesReviewPlan,
} as const;
