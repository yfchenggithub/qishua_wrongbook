import { withDatabaseTransaction } from '@/src/db';
import { MAX_REVIEW_COUNT, REVIEW_STATUS } from '@/src/constants/review';
import type { CompleteReviewInput, CompleteReviewResult } from '@/src/models/ReviewFlow';
import type { ReviewResult } from '@/src/models/Mistake';
import type { ReviewRecordVoiceNote } from '@/src/models/ReviewRecord';
import { MistakeImageRepository, MistakeRepository, ReviewRecordRepository } from '@/src/repositories';
import * as ImageService from '@/src/services/ImageService';
import { Logger } from '@/src/services/Logger';
import * as ReviewReminderService from '@/src/services/ReviewReminderService';
import {
  calculateNextReviewAt,
  canStartReview,
  getNextReviewIndex,
  getReviewStatusAfterComplete,
} from '@/src/services/ReviewScheduleService';

const SERVICE_SCOPE = 'CompleteReviewService';
const REVIEW_STATE_CHANGED_MESSAGE = '复做状态已变化，请返回详情页刷新';
const UNKNOWN_ERROR_MESSAGE = '提交复做失败，请稍后重试。';
const REVIEW_RESULT_VALUES: ReviewResult[] = ['mastered', 'unsure', 'wrong'];
const VOICE_NOTE_BINDING_FAILED_MESSAGE = '复做已保存，但语音讲解未能绑定到本次记录。';

interface NormalizedCompleteReviewInput {
  mistakeId: string;
  reviewIndex: number;
  solutionImageUri: string | null;
  voiceNote: ReviewRecordVoiceNote | null;
  voiceNoteDropped: boolean;
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

function normalizeReviewResult(result: ReviewResult): ReviewResult | null {
  if (REVIEW_RESULT_VALUES.includes(result)) {
    return result;
  }
  return null;
}

function normalizeReviewRecordVoiceNote(
  value: ReviewRecordVoiceNote | null | undefined,
): ReviewRecordVoiceNote | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const fileUri = typeof value.fileUri === 'string' ? value.fileUri.trim() : '';
  const fileName = typeof value.fileName === 'string' ? value.fileName.trim() : '';
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt.trim() : '';
  const durationMs =
    typeof value.durationMs === 'number' && Number.isFinite(value.durationMs)
      ? Math.max(0, Math.floor(value.durationMs))
      : NaN;
  const sizeBytes =
    typeof value.sizeBytes === 'number' && Number.isFinite(value.sizeBytes)
      ? Math.max(0, Math.floor(value.sizeBytes))
      : NaN;

  if (!id || !fileUri || !fileName || !createdAt) {
    return null;
  }
  if (!Number.isFinite(durationMs) || !Number.isFinite(sizeBytes)) {
    return null;
  }
  if (Number.isNaN(new Date(createdAt).getTime())) {
    return null;
  }

  return {
    id,
    fileUri,
    fileName,
    durationMs,
    sizeBytes,
    createdAt,
  };
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

  const solutionImageUriRaw =
    typeof input.solutionImageUri === 'string' ? input.solutionImageUri.trim() : '';
  const solutionImageUri = solutionImageUriRaw.length > 0 ? solutionImageUriRaw : null;
  const voiceNoteFromInput = input.voiceNote ?? null;
  const voiceNote = normalizeReviewRecordVoiceNote(voiceNoteFromInput);
  const voiceNoteDropped = voiceNoteFromInput !== null && voiceNote === null;

  const result = normalizeReviewResult(input.result);
  if (!result) {
    return {
      ok: false,
      errorMessage: 'result 必须是 mastered / unsure / wrong',
    };
  }

  return {
    ok: true,
    value: {
      mistakeId,
      reviewIndex: input.reviewIndex,
      solutionImageUri,
      voiceNote,
      voiceNoteDropped,
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
    hasVoiceNote: !!input.voiceNote,
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
  let warningMessage: string | undefined;

  if (normalizedInput.voiceNoteDropped) {
    warningMessage = VOICE_NOTE_BINDING_FAILED_MESSAGE;
    Logger.warn(SERVICE_SCOPE, 'Voice note payload was dropped because it was invalid.', {
      mistakeId: normalizedInput.mistakeId,
      reviewIndex: normalizedInput.reviewIndex,
    });
  }

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
    let voiceNoteBindingFailed = normalizedInput.voiceNoteDropped;
    let createdReviewRecordId: string | undefined;
    Logger.info(SERVICE_SCOPE, 'Calculated review progress update in completeReview.', {
      mistakeId: normalizedInput.mistakeId,
      reviewIndex: normalizedInput.reviewIndex,
      currentReviewCount: mistake.review_count,
      newReviewCount,
      newStatus,
      nextReviewAt,
      hasVoiceNote: normalizedInput.voiceNote !== null,
    });

    try {
      await withDatabaseTransaction(async (db) => {
        const createdReviewRecord = await ReviewRecordRepository.createReviewRecordInTransaction(db, {
          mistake_id: normalizedInput.mistakeId,
          review_index: normalizedInput.reviewIndex,
          result: normalizedInput.result,
          note: null,
          createdAt: nowIso,
        });
        Logger.info(SERVICE_SCOPE, 'Created review_record successfully in transaction.', {
          mistakeId: normalizedInput.mistakeId,
          reviewRecordId: createdReviewRecord.id,
          reviewIndex: normalizedInput.reviewIndex,
        });
        createdReviewRecordId = createdReviewRecord.id;

        if (normalizedInput.solutionImageUri) {
          await MistakeImageRepository.insertReviewSolutionImagesInTransaction(
            db,
            normalizedInput.mistakeId,
            createdReviewRecord.id,
            [
              {
                type: 'review_solution',
                uri: normalizedInput.solutionImageUri,
                sort_order: 0,
              },
            ],
            nowIso,
          );
          Logger.info(
            SERVICE_SCOPE,
            'Created review_solution mistake_images row successfully in transaction.',
            {
              mistakeId: normalizedInput.mistakeId,
              reviewRecordId: createdReviewRecord.id,
              reviewIndex: normalizedInput.reviewIndex,
              solutionImageUriShort: toShortUri(normalizedInput.solutionImageUri),
            },
          );
        } else {
          Logger.info(
            SERVICE_SCOPE,
            'Skipped creating review_solution mistake_images row because no review photo was provided.',
            {
              mistakeId: normalizedInput.mistakeId,
              reviewRecordId: createdReviewRecord.id,
              reviewIndex: normalizedInput.reviewIndex,
            },
          );
        }

        if (normalizedInput.voiceNote) {
          try {
            const bound = await ReviewRecordRepository.updateReviewRecordVoiceNoteInTransaction(
              db,
              createdReviewRecord.id,
              normalizedInput.voiceNote,
            );

            if (!bound) {
              voiceNoteBindingFailed = true;
              Logger.warn(SERVICE_SCOPE, 'bind_voice_note_to_review_record', {
                ok: false,
                reason: 'review_record_not_found',
                mistakeId: normalizedInput.mistakeId,
                reviewRecordId: createdReviewRecord.id,
                reviewIndex: normalizedInput.reviewIndex,
              });
            } else {
              Logger.info(SERVICE_SCOPE, 'bind_voice_note_to_review_record', {
                ok: true,
                mistakeId: normalizedInput.mistakeId,
                reviewRecordId: createdReviewRecord.id,
                reviewIndex: normalizedInput.reviewIndex,
                voiceNoteId: normalizedInput.voiceNote.id,
              });
            }
          } catch (voiceNoteError) {
            voiceNoteBindingFailed = true;
            Logger.error(SERVICE_SCOPE, 'bind_voice_note_to_review_record', {
              ok: false,
              reason: 'bind_failed',
              mistakeId: normalizedInput.mistakeId,
              reviewRecordId: createdReviewRecord.id,
              reviewIndex: normalizedInput.reviewIndex,
              voiceNoteId: normalizedInput.voiceNote.id,
              voiceNoteError,
            });
          }
        } else {
          Logger.info(SERVICE_SCOPE, 'bind_voice_note_to_review_record', {
            ok: true,
            skipped: true,
            reason: 'no_voice_note',
            mistakeId: normalizedInput.mistakeId,
            reviewRecordId: createdReviewRecord.id,
            reviewIndex: normalizedInput.reviewIndex,
          });
        }

        const affectedRows = await MistakeRepository.updateReviewProgressInTransaction(db, {
          mistakeId: normalizedInput.mistakeId,
          oldReviewCount: mistake.review_count,
          newReviewCount,
          newStatus,
          nextReviewAt,
          lastReviewAt: nowIso,
          lastReviewResult: normalizedInput.result,
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
        voiceNoteBindingSuccess: !voiceNoteBindingFailed,
      });

      if (voiceNoteBindingFailed) {
        warningMessage = VOICE_NOTE_BINDING_FAILED_MESSAGE;
      }
    } catch (error) {
      if (normalizedInput.cleanupImageOnFailure && normalizedInput.solutionImageUri) {
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
      reviewRecordId: createdReviewRecordId ?? null,
      newReviewCount,
      newStatus,
      nextReviewAt: newStatus === REVIEW_STATUS.MASTERED ? null : nextReviewAt,
      hasWarningMessage: !!warningMessage,
    });
    void ReviewReminderService.refreshReminderSchedule({ reason: 'complete_review' }).catch((error) => {
      Logger.warn(SERVICE_SCOPE, 'Reminder schedule refresh failed after completing review.', {
        mistakeId: normalizedInput.mistakeId,
        error,
      });
    });

    return {
      ok: true,
      mistakeId: normalizedInput.mistakeId,
      reviewRecordId: createdReviewRecordId,
      reviewIndex: normalizedInput.reviewIndex,
      newReviewCount,
      newStatus,
      nextReviewAt: newStatus === REVIEW_STATUS.MASTERED ? null : nextReviewAt,
      warningMessage,
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
