import type { ReviewResult } from '@/src/models/Mistake';
import type { ReviewRecordVoiceNote } from '@/src/models/ReviewRecord';
import { REVIEW_TEXT_NOTE_MAX_LENGTH } from '@/src/constants/review';
import { withDatabaseTransaction } from '@/src/db';
import { MistakeImageRepository, MistakeRepository, ReviewRecordRepository } from '@/src/repositories';
import type { ReviewPageData } from '@/src/services/ReviewFlowService';
import * as CompleteReviewService from '@/src/services/CompleteReviewService';
import { Logger } from '@/src/services/Logger';
import * as MistakeListService from '@/src/services/MistakeListService';
import * as ReviewFlowService from '@/src/services/ReviewFlowService';

const SERVICE_SCOPE = 'ReviewSessionService';
const FALLBACK_LOAD_ERROR = '\u8bfb\u53d6\u590d\u505a\u9898\u76ee\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002';

const FALLBACK_UPDATE_ERROR = '\u4fee\u6539\u672c\u6b21\u590d\u505a\u7ed3\u679c\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002';
const REVIEW_RESULT_VALUES: ReviewResult[] = ['mastered', 'unsure', 'wrong'];

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

export type UpdateTodayReviewResultResult =
  | {
      ok: true;
      warningMessage?: string;
    }
  | {
      ok: false;
      errorMessage: string;
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

function normalizeRequiredId(value: string, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`${fieldName} cannot be empty.`);
  }
  return normalized;
}

function normalizeReviewResult(value: ReviewResult): ReviewResult {
  if (REVIEW_RESULT_VALUES.includes(value)) {
    return value;
  }
  throw new Error('result must be mastered / unsure / wrong.');
}

function normalizeReviewTextNote(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length > REVIEW_TEXT_NOTE_MAX_LENGTH) {
    throw new Error(`文字讲解不能超过 ${REVIEW_TEXT_NOTE_MAX_LENGTH} 字`);
  }
  return normalized.length > 0 ? normalized : null;
}

function normalizeReviewRecordVoiceNote(value: ReviewRecordVoiceNote | null | undefined): ReviewRecordVoiceNote | null {
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

export async function loadTodayReviewItem(
  mistakeId: string,
  options?: { allowSubmitted?: boolean },
): Promise<LoadTodayReviewItemResult> {
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

    if (!result.data.session.canReview && options?.allowSubmitted !== true) {
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
  note?: string | null;
  voiceNote?: ReviewRecordVoiceNote | null;
}) {
  return CompleteReviewService.completeReview({
    mistakeId: input.mistakeId,
    reviewIndex: input.reviewIndex,
    result: input.result,
    solutionImageUri: input.solutionImageUri ?? null,
    note: input.note ?? null,
    voiceNote: input.voiceNote ?? null,
    cleanupImageOnFailure: false,
  });
}

export async function updateTodayReviewResult(input: {
  mistakeId: string;
  reviewRecordId: string;
  result: ReviewResult;
  solutionImageUri?: string | null;
  note?: string | null;
  voiceNote?: ReviewRecordVoiceNote | null;
}): Promise<UpdateTodayReviewResultResult> {
  try {
    const mistakeId = normalizeRequiredId(input.mistakeId, 'mistakeId');
    const reviewRecordId = normalizeRequiredId(input.reviewRecordId, 'reviewRecordId');
    const result = normalizeReviewResult(input.result);
    const solutionImageUriRaw =
      typeof input.solutionImageUri === 'string' ? input.solutionImageUri.trim() : '';
    const solutionImageUri = solutionImageUriRaw.length > 0 ? solutionImageUriRaw : null;
    const note = normalizeReviewTextNote(input.note);
    const voiceNoteFromInput = input.voiceNote ?? null;
    const voiceNote = normalizeReviewRecordVoiceNote(voiceNoteFromInput);
    const voiceNoteDropped = voiceNoteFromInput !== null && voiceNote === null;
    const nowIso = new Date().toISOString();

    await withDatabaseTransaction(async (db) => {
      const resultUpdated = await ReviewRecordRepository.updateReviewRecordResultInTransaction(
        db,
        reviewRecordId,
        result,
      );
      if (!resultUpdated) {
        throw new Error('Review record does not exist.');
      }

      const noteUpdated = await ReviewRecordRepository.updateReviewRecordNoteInTransaction(
        db,
        reviewRecordId,
        note,
      );
      if (!noteUpdated) {
        throw new Error('Review record does not exist.');
      }

      const voiceUpdated = await ReviewRecordRepository.updateReviewRecordVoiceNoteInTransaction(
        db,
        reviewRecordId,
        voiceNote,
      );
      if (!voiceUpdated) {
        throw new Error('Review record does not exist.');
      }

      if (solutionImageUri) {
        await MistakeImageRepository.upsertReviewSolutionImageByReviewRecordIdInTransaction(
          db,
          mistakeId,
          reviewRecordId,
          solutionImageUri,
          nowIso,
        );
      } else {
        await MistakeImageRepository.deleteImagesByReviewRecordIdInTransaction(db, reviewRecordId);
      }

      const affectedMistakeRows = await MistakeRepository.updateLastReviewResultInTransaction(db, {
        mistakeId,
        lastReviewResult: result,
        updatedAt: nowIso,
      });
      if (affectedMistakeRows <= 0) {
        throw new Error('Mistake does not exist.');
      }
    });

    return {
      ok: true,
      warningMessage: voiceNoteDropped ? '\u8bed\u97f3\u8bb2\u89e3\u6570\u636e\u65e0\u6548\uff0c\u5df2\u4fdd\u7559\u7ed3\u679c\u4fee\u6539\u3002' : undefined,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'updateTodayReviewResult failed unexpectedly.', {
      mistakeId: input.mistakeId,
      reviewRecordId: input.reviewRecordId,
      error,
    });
    return {
      ok: false,
      errorMessage: error instanceof Error && error.message.trim() ? error.message : FALLBACK_UPDATE_ERROR,
    };
  }
}
