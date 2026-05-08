import { withDatabaseTransaction } from '@/src/db';
import { MAX_REVIEW_COUNT, REVIEW_STATUS } from '@/src/constants/review';
import type { CompleteReviewInput, CompleteReviewResult } from '@/src/models/ReviewFlow';
import type { ReviewResult } from '@/src/models/Mistake';
import { MistakeImageRepository, MistakeRepository, ReviewRecordRepository } from '@/src/repositories';
import * as ImageService from '@/src/services/ImageService';
import { Logger } from '@/src/services/Logger';
import {
  calculateNextReviewAt,
  canStartReview,
  getNextReviewIndex,
  getReviewStatusAfterComplete,
} from '@/src/services/ReviewScheduleService';

const SERVICE_SCOPE = 'CompleteReviewService';
const REVIEW_STATE_CHANGED_MESSAGE = '复做状态已变化，请返回详情页刷新';
const UNKNOWN_ERROR_MESSAGE = '提交复做失败，请稍后重试。';
const REVIEW_RESULT_VALUES: ReviewResult[] = ['done', 'still_wrong', 'too_easy'];

interface NormalizedCompleteReviewInput {
  mistakeId: string;
  reviewIndex: number;
  solutionImageUri: string;
  result: ReviewResult;
  cleanupImageOnFailure: boolean;
}

function toShortUri(uri: string | null | undefined): string | null {
  if (typeof uri !== 'string') {
    return null;
  }

  const trimmed = uri.trim();
  if (trimmed.length <= 64) {
    return trimmed;
  }
  return `${trimmed.slice(0, 28)}...${trimmed.slice(-20)}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : UNKNOWN_ERROR_MESSAGE;
  }

  const message = String(error ?? '').trim();
  return message.length > 0 ? message : UNKNOWN_ERROR_MESSAGE;
}

function normalizeReviewResult(result: ReviewResult | undefined): ReviewResult | null {
  if (result === undefined) {
    return 'done';
  }
  if (REVIEW_RESULT_VALUES.includes(result)) {
    return result;
  }
  return null;
}

function normalizeCompleteReviewInput(input: CompleteReviewInput): {
  ok: true;
  value: NormalizedCompleteReviewInput;
} | {
  ok: false;
  errorMessage: string;
} {
  const mistakeId = typeof input.mistakeId === 'string' ? input.mistakeId.trim() : '';
  if (!mistakeId) {
    return {
      ok: false,
      errorMessage: '错题 ID 不能为空',
    };
  }

  if (
    !Number.isInteger(input.reviewIndex) ||
    input.reviewIndex < 1 ||
    input.reviewIndex > MAX_REVIEW_COUNT
  ) {
    return {
      ok: false,
      errorMessage: `reviewIndex 必须是 1 到 ${MAX_REVIEW_COUNT} 的整数`,
    };
  }

  const solutionImageUri =
    typeof input.solutionImageUri === 'string' ? input.solutionImageUri.trim() : '';
  if (!solutionImageUri) {
    return {
      ok: false,
      errorMessage: 'solutionImageUri 不能为空',
    };
  }

  const result = normalizeReviewResult(input.result);
  if (!result) {
    return {
      ok: false,
      errorMessage: 'result 必须是 done / still_wrong / too_easy',
    };
  }

  return {
    ok: true,
    value: {
      mistakeId,
      reviewIndex: input.reviewIndex,
      solutionImageUri,
      result,
      cleanupImageOnFailure: input.cleanupImageOnFailure !== false,
    },
  };
}

function buildCannotReviewMessage(reason?: string): string {
  if (reason === '已完成七刷' || reason === '已归档') {
    return `${reason}，不能继续复做`;
  }
  if (reason && reason.trim().length > 0) {
    return reason;
  }
  return '当前状态不能继续复做';
}

export async function completeReview(input: CompleteReviewInput): Promise<CompleteReviewResult> {
  Logger.info(SERVICE_SCOPE, 'Start completeReview.', {
    mistakeId: input.mistakeId,
    reviewIndex: input.reviewIndex,
    cleanupImageOnFailure: input.cleanupImageOnFailure !== false,
    solutionImageUriShort: toShortUri(input.solutionImageUri),
  });

  const normalizedInputResult = normalizeCompleteReviewInput(input);
  if (!normalizedInputResult.ok) {
    Logger.warn(SERVICE_SCOPE, 'completeReview input validation failed.', {
      mistakeId: input.mistakeId,
      reviewIndex: input.reviewIndex,
      errorMessage: normalizedInputResult.errorMessage,
    });
    return {
      ok: false,
      errorMessage: normalizedInputResult.errorMessage,
    };
  }

  const normalizedInput = normalizedInputResult.value;

  try {
    const mistake = await MistakeRepository.getMistakeById(normalizedInput.mistakeId);
    if (!mistake) {
      Logger.warn(SERVICE_SCOPE, 'completeReview aborted because mistake does not exist.', {
        mistakeId: normalizedInput.mistakeId,
        reviewIndex: normalizedInput.reviewIndex,
      });
      return {
        ok: false,
        errorMessage: '错题不存在',
      };
    }

    Logger.info(SERVICE_SCOPE, 'Loaded mistake for completeReview.', {
      mistakeId: normalizedInput.mistakeId,
      reviewIndex: normalizedInput.reviewIndex,
      currentReviewCount: mistake.review_count,
      currentStatus: mistake.status,
    });

    const canReviewResult = canStartReview({
      status: mistake.status,
      reviewCount: mistake.review_count,
    });
    if (!canReviewResult.canReview) {
      Logger.warn(SERVICE_SCOPE, 'completeReview rejected by canStartReview guard.', {
        mistakeId: normalizedInput.mistakeId,
        reviewIndex: normalizedInput.reviewIndex,
        currentReviewCount: mistake.review_count,
        currentStatus: mistake.status,
        reason: canReviewResult.reason ?? null,
      });
      return {
        ok: false,
        errorMessage: buildCannotReviewMessage(canReviewResult.reason),
      };
    }

    const expectedReviewIndex = getNextReviewIndex(mistake.review_count);
    Logger.info(SERVICE_SCOPE, 'Calculated expected review index for completeReview.', {
      mistakeId: normalizedInput.mistakeId,
      currentReviewCount: mistake.review_count,
      expectedReviewIndex,
      inputReviewIndex: normalizedInput.reviewIndex,
    });
    if (normalizedInput.reviewIndex !== expectedReviewIndex) {
      Logger.warn(SERVICE_SCOPE, 'completeReview rejected because reviewIndex mismatched expected value.', {
        mistakeId: normalizedInput.mistakeId,
        currentReviewCount: mistake.review_count,
        expectedReviewIndex,
        inputReviewIndex: normalizedInput.reviewIndex,
      });
      return {
        ok: false,
        errorMessage: REVIEW_STATE_CHANGED_MESSAGE,
      };
    }

    const newReviewCount = mistake.review_count + 1;
    const newStatus = getReviewStatusAfterComplete(newReviewCount);
    const nextReviewAt = calculateNextReviewAt(newReviewCount);
    const nowIso = new Date().toISOString();
    Logger.info(SERVICE_SCOPE, 'Calculated review progress update in completeReview.', {
      mistakeId: normalizedInput.mistakeId,
      reviewIndex: normalizedInput.reviewIndex,
      currentReviewCount: mistake.review_count,
      newReviewCount,
      newStatus,
      nextReviewAt,
    });

    try {
      await withDatabaseTransaction(async (db) => {
        await ReviewRecordRepository.createReviewRecordInTransaction(db, {
          mistake_id: normalizedInput.mistakeId,
          review_index: normalizedInput.reviewIndex,
          solution_image_uri: normalizedInput.solutionImageUri,
          result: normalizedInput.result,
          createdAt: nowIso,
        });
        Logger.info(SERVICE_SCOPE, 'Created review_record successfully in transaction.', {
          mistakeId: normalizedInput.mistakeId,
          reviewIndex: normalizedInput.reviewIndex,
        });

        await MistakeImageRepository.createMistakeImageInTransaction(db, {
          mistake_id: normalizedInput.mistakeId,
          type: 'review_solution',
          uri: normalizedInput.solutionImageUri,
          createdAt: nowIso,
        });
        Logger.info(SERVICE_SCOPE, 'Created review_solution mistake_images row successfully in transaction.', {
          mistakeId: normalizedInput.mistakeId,
          reviewIndex: normalizedInput.reviewIndex,
          solutionImageUriShort: toShortUri(normalizedInput.solutionImageUri),
        });

        const affectedRows = await MistakeRepository.updateReviewProgressInTransaction(db, {
          mistakeId: normalizedInput.mistakeId,
          oldReviewCount: mistake.review_count,
          newReviewCount,
          newStatus,
          nextReviewAt,
          updatedAt: nowIso,
        });

        if (affectedRows <= 0) {
          throw new Error(REVIEW_STATE_CHANGED_MESSAGE);
        }

        Logger.info(SERVICE_SCOPE, 'Updated mistakes review progress successfully in transaction.', {
          mistakeId: normalizedInput.mistakeId,
          reviewIndex: normalizedInput.reviewIndex,
          affectedRows,
          oldReviewCount: mistake.review_count,
          newReviewCount,
          newStatus,
          nextReviewAt,
        });
      });
      Logger.info(SERVICE_SCOPE, 'completeReview transaction committed successfully.', {
        mistakeId: normalizedInput.mistakeId,
        reviewIndex: normalizedInput.reviewIndex,
        newReviewCount,
        newStatus,
        nextReviewAt,
      });
    } catch (error) {
      if (normalizedInput.cleanupImageOnFailure) {
        Logger.warn(SERVICE_SCOPE, 'Attempting to cleanup orphan review image after transaction failure.', {
          mistakeId: normalizedInput.mistakeId,
          reviewIndex: normalizedInput.reviewIndex,
          solutionImageUriShort: toShortUri(normalizedInput.solutionImageUri),
        });
        try {
          const cleaned = await ImageService.deleteLocalImage(normalizedInput.solutionImageUri);
          if (!cleaned) {
            Logger.warn(SERVICE_SCOPE, 'Failed to cleanup orphan review image after transaction failure.', {
              mistakeId: normalizedInput.mistakeId,
              reviewIndex: normalizedInput.reviewIndex,
              solutionImageUriShort: toShortUri(normalizedInput.solutionImageUri),
            });
          } else {
            Logger.info(SERVICE_SCOPE, 'Cleaned orphan review image after transaction failure.', {
              mistakeId: normalizedInput.mistakeId,
              reviewIndex: normalizedInput.reviewIndex,
              solutionImageUriShort: toShortUri(normalizedInput.solutionImageUri),
            });
          }
        } catch (cleanupError) {
          Logger.warn(SERVICE_SCOPE, 'Cleanup orphan review image threw an exception.', {
            mistakeId: normalizedInput.mistakeId,
            reviewIndex: normalizedInput.reviewIndex,
            solutionImageUriShort: toShortUri(normalizedInput.solutionImageUri),
            cleanupError,
          });
        }
      }

      Logger.error(SERVICE_SCOPE, 'completeReview transaction failed.', {
        mistakeId: normalizedInput.mistakeId,
        reviewIndex: normalizedInput.reviewIndex,
        currentReviewCount: mistake.review_count,
        newReviewCount,
        newStatus,
        nextReviewAt,
        solutionImageUriShort: toShortUri(normalizedInput.solutionImageUri),
        error,
      });
      return {
        ok: false,
        errorMessage: toErrorMessage(error),
      };
    }

    Logger.info(SERVICE_SCOPE, 'completeReview finished successfully.', {
      mistakeId: normalizedInput.mistakeId,
      reviewIndex: normalizedInput.reviewIndex,
      newReviewCount,
      newStatus,
      nextReviewAt: newStatus === REVIEW_STATUS.MASTERED ? null : nextReviewAt,
    });

    return {
      ok: true,
      mistakeId: normalizedInput.mistakeId,
      reviewIndex: normalizedInput.reviewIndex,
      newReviewCount,
      newStatus,
      nextReviewAt: newStatus === REVIEW_STATUS.MASTERED ? null : nextReviewAt,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'completeReview failed unexpectedly.', {
      mistakeId: normalizedInput.mistakeId,
      reviewIndex: normalizedInput.reviewIndex,
      solutionImageUriShort: toShortUri(normalizedInput.solutionImageUri),
      error,
    });
    return {
      ok: false,
      errorMessage: toErrorMessage(error),
    };
  }
}
