import { withDatabaseTransaction } from '@/src/db';
import { REVIEW_STATUS } from '@/src/constants/review';
import type { AddMistakeDraft } from '@/src/models/AddMistakeDraft';
import type { ImageType } from '@/src/models/Mistake';
import { MistakeImageRepository, MistakeRepository } from '@/src/repositories';
import { validateAddMistakeDraft } from '@/src/services/AddMistakeValidationService';
import { Logger } from '@/src/services/Logger';
import * as ReviewReminderService from '@/src/services/ReviewReminderService';
import type * as SQLite from 'expo-sqlite';

const SERVICE_SCOPE = 'CreateMistakeService';
const DEFAULT_SUBJECT = 'math';
const FALLBACK_ERROR_MESSAGE = '保存错题失败，请稍后重试。';

type CreateMistakeFromDraftResult = {
  ok: boolean;
  mistakeId?: string;
  errorMessage?: string;
};

type CreateMistakeFromDraftOptions = {
  questionNo?: number;
  joinReviewPlan?: boolean;
};

type MistakeImageInput = {
  type: Exclude<ImageType, 'review_solution'>;
  uri: string;
  sort_order: number;
};

type DraftImagePresence = {
  hasQuestionImage: boolean;
  hasMySolutionImage: boolean;
  hasAnswerImage: boolean;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeQuestionNo(questionNo: number | undefined): number {
  if (typeof questionNo !== 'number' || !Number.isFinite(questionNo)) {
    return 1;
  }
  const normalized = Math.floor(questionNo);
  return normalized > 0 ? normalized : 1;
}

function buildCanonicalQuestionTitle(moduleName: string, questionNo: number | undefined): string {
  const normalizedQuestionNo = normalizeQuestionNo(questionNo);
  return `${moduleName} · 第 ${normalizedQuestionNo} 题`;
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

function getDraftImagePresence(draft: AddMistakeDraft): DraftImagePresence {
  return {
    hasQuestionImage: !!draft.questionImage?.uri?.trim(),
    hasMySolutionImage: !!draft.mySolutionImage?.uri?.trim(),
    hasAnswerImage: !!draft.answerImage?.uri?.trim(),
  };
}

function collectImageInputs(draft: AddMistakeDraft): MistakeImageInput[] {
  const images: MistakeImageInput[] = [];
  let nextSortOrder = 0;

  const questionUri = draft.questionImage?.uri?.trim();
  if (questionUri) {
    images.push({
      type: 'question',
      uri: questionUri,
      sort_order: nextSortOrder,
    });
    nextSortOrder += 1;
  }

  const mySolutionUri = draft.mySolutionImage?.uri?.trim();
  if (mySolutionUri) {
    images.push({
      type: 'my_solution',
      uri: mySolutionUri,
      sort_order: nextSortOrder,
    });
    nextSortOrder += 1;
  }

  const answerUri = draft.answerImage?.uri?.trim();
  if (answerUri) {
    images.push({
      type: 'answer',
      uri: answerUri,
      sort_order: nextSortOrder,
    });
  }

  return images;
}

async function persistDraft(
  db: SQLite.SQLiteDatabase,
  draft: AddMistakeDraft,
  mistakeId: string,
  questionNo: number | undefined,
  joinReviewPlan: boolean,
  onMistakeCreated?: () => void,
): Promise<number> {
  const moduleName = draft.module?.trim();
  if (!moduleName) {
    throw new Error('模块不能为空。');
  }

  const questionImageUri = draft.questionImage?.uri?.trim();
  if (!questionImageUri) {
    throw new Error('题目照片必填。');
  }

  const answerImageUri = normalizeOptionalText(draft.answerImage?.uri) ?? null;
  const imagePresence = getDraftImagePresence(draft);

  Logger.info(SERVICE_SCOPE, 'Start persisting mistake draft.', {
    draftId: draft.draftId,
    mistakeId,
    module: moduleName,
    imagePresence,
    questionImageUriShort: toShortUri(questionImageUri),
    answerImageUriShort: toShortUri(answerImageUri),
  });

  await MistakeRepository.createMistakeInTransaction(db, {
    id: mistakeId,
    subject: draft.subject?.trim() || DEFAULT_SUBJECT,
    module: moduleName,
    title: buildCanonicalQuestionTitle(moduleName, questionNo),
    error_reason: normalizeOptionalText(draft.errorReason),
    difficulty: draft.difficulty,
    note: normalizeOptionalText(draft.note),
    status: joinReviewPlan ? REVIEW_STATUS.ACTIVE : REVIEW_STATUS.COLLECTED,
    next_review_at: joinReviewPlan ? new Date().toISOString() : null,
  });
  onMistakeCreated?.();
  Logger.info(SERVICE_SCOPE, 'Created mistakes row successfully.', {
    draftId: draft.draftId,
    mistakeId,
  });

  const imageInputs = collectImageInputs(draft);
  await MistakeImageRepository.insertMistakeImagesInTransaction(db, mistakeId, imageInputs);

  Logger.info(SERVICE_SCOPE, 'Created mistake_images rows successfully.', {
    draftId: draft.draftId,
    mistakeId,
    mistakeImageCount: imageInputs.length,
  });

  return imageInputs.length;
}

async function resolveQuestionNoForDraft(
  db: SQLite.SQLiteDatabase,
  draft: AddMistakeDraft,
  options?: CreateMistakeFromDraftOptions,
): Promise<number> {
  if (typeof options?.questionNo === 'number') {
    return normalizeQuestionNo(options.questionNo);
  }

  const moduleName = draft.module?.trim();
  if (!moduleName) {
    throw new Error('模块不能为空。');
  }

  const reservedQuestionNumbers = await MistakeRepository.reserveNextQuestionNumbersByModuleInTransaction(
    db,
    moduleName,
    1,
  );
  return normalizeQuestionNo(reservedQuestionNumbers[0]);
}

export async function createMistakeFromDraft(
  draft: AddMistakeDraft,
  options?: CreateMistakeFromDraftOptions,
): Promise<CreateMistakeFromDraftResult> {
  const imagePresence = getDraftImagePresence(draft);
  Logger.info(SERVICE_SCOPE, 'Start saving mistake draft.', {
    draftId: draft.draftId,
    imagePresence,
  });

  const validation = validateAddMistakeDraft(draft);
  if (!validation.ok) {
    Logger.warn(SERVICE_SCOPE, 'Draft validation failed before save.', {
      draftId: draft.draftId,
      errors: validation.errors,
      imagePresence,
    });
    return {
      ok: false,
      errorMessage: validation.errors.join('\n'),
    };
  }

  const mistakeId = typeof draft.draftId === 'string' ? draft.draftId.trim() : '';
  if (!mistakeId) {
    Logger.warn(SERVICE_SCOPE, 'Draft save aborted because draftId is empty.', {
      draftId: draft.draftId,
    });
    return {
      ok: false,
      errorMessage: 'draftId 不能为空。',
    };
  }

  let mistakeCreated = false;
  let mistakeImageCount = 0;

  try {
    await withDatabaseTransaction(async (db) => {
      const questionNo = await resolveQuestionNoForDraft(db, draft, options);
      mistakeImageCount = await persistDraft(
        db,
        draft,
        mistakeId,
        questionNo,
        options?.joinReviewPlan === true,
        () => {
          mistakeCreated = true;
        },
      );
    });

    Logger.info(SERVICE_SCOPE, 'Saved mistake draft successfully.', {
      draftId: draft.draftId,
      mistakeId,
      mistakeImageCount,
    });
    void ReviewReminderService.refreshReminderSchedule({ reason: 'create_mistake' }).catch((error) => {
      Logger.warn(SERVICE_SCOPE, 'Reminder schedule refresh failed after creating mistake.', {
        mistakeId,
        error,
      });
    });

    return {
      ok: true,
      mistakeId,
    };
  } catch (error) {
    if (mistakeCreated) {
      try {
        await MistakeRepository.deleteMistake(mistakeId);
        Logger.warn(SERVICE_SCOPE, 'Compensating rollback succeeded for created mistake.', {
          draftId: draft.draftId,
          mistakeId,
        });
      } catch (rollbackError) {
        Logger.error(SERVICE_SCOPE, 'Compensating rollback failed.', {
          draftId: draft.draftId,
          mistakeId,
          rollbackError,
        });
      }
    }

    Logger.error(SERVICE_SCOPE, 'Failed to save mistake draft.', {
      draftId: draft.draftId,
      mistakeId,
      imagePresence,
      error,
    });

    return {
      ok: false,
      errorMessage: toErrorMessage(error) || FALLBACK_ERROR_MESSAGE,
    };
  }
}
