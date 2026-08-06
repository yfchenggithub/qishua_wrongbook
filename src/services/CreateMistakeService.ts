import { withDatabaseTransaction } from '@/src/db';
import { REVIEW_STATUS } from '@/src/constants/review';
import { UNCLASSIFIED_MODULE } from '@/src/constants/mistakeOptions';
import {
  UNCLASSIFIED_MODULE_ID,
  resolveSystemModuleByLegacyIdOrName,
} from '@/src/constants/modules';
import type { AddMistakeDraft } from '@/src/models/AddMistakeDraft';
import type { ImageType } from '@/src/models/Mistake';
import { MistakeImageRepository, MistakeRepository } from '@/src/repositories';
import { validateAddMistakeDraft } from '@/src/services/AddMistakeValidationService';
import { Logger } from '@/src/services/Logger';
import * as ReviewReminderService from '@/src/services/ReviewReminderService';
import { createMistakeId } from '@/src/utils/id';
import type * as SQLite from 'expo-sqlite';

const SERVICE_SCOPE = 'CreateMistakeService';
const DEFAULT_SUBJECT = 'math';
const FALLBACK_ERROR_MESSAGE = '保存错题失败，请稍后重试。';

type CreateMistakeFromDraftResult = {
  ok: boolean;
  mistakeId?: string;
  errorMessage?: string;
};

export type CreateMistakesFromDraftResult = CreateMistakeFromDraftResult & {
  mistakeIds?: string[];
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

function parseSelectedModuleId(value: string | null | undefined): number | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return null;
  }
  const direct = Number.parseInt(normalized, 10);
  if (/^\d+$/u.test(normalized) && direct > 0) {
    return direct;
  }
  const customMatched = normalized.match(/^custom:(\d+)$/u);
  if (customMatched) {
    return Number.parseInt(customMatched[1], 10);
  }
  return null;
}

function resolveDraftModule(draft: AddMistakeDraft): { moduleName: string; moduleId: number } {
  const moduleName = normalizeOptionalText(draft.module);
  if (!moduleName) {
    return { moduleName: UNCLASSIFIED_MODULE, moduleId: UNCLASSIFIED_MODULE_ID };
  }
  const selectedModuleId = parseSelectedModuleId(draft.moduleId);
  const systemModule = resolveSystemModuleByLegacyIdOrName(draft.moduleId, moduleName);
  return {
    moduleName,
    moduleId: selectedModuleId ?? systemModule?.id ?? UNCLASSIFIED_MODULE_ID,
  };
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
    hasQuestionImage: getImages(draft.questionImages, draft.questionImage).length > 0,
    hasMySolutionImage: getImages(draft.mySolutionImages, draft.mySolutionImage).length > 0,
    hasAnswerImage: getImages(draft.answerImages, draft.answerImage).length > 0,
  };
}

function getImages(images: readonly AddMistakeDraft['questionImages'][number][], fallback: AddMistakeDraft['questionImage']) {
  const validImages = Array.isArray(images)
    ? images.filter((image) => typeof image?.uri === 'string' && image.uri.trim().length > 0)
    : [];
  if (validImages.length > 0) {
    return validImages;
  }
  return fallback?.uri?.trim() ? [fallback] : [];
}

function collectImageInputs(draft: AddMistakeDraft): MistakeImageInput[] {
  const images: MistakeImageInput[] = [];
  const appendImages = (
    type: MistakeImageInput['type'],
    localImages: ReturnType<typeof getImages>,
  ) => {
    localImages.forEach((image, index) => {
      const uri = image.uri.trim();
      if (!uri) {
        return;
      }
      images.push({ type, uri, sort_order: index });
    });
  };

  appendImages('question', getImages(draft.questionImages, draft.questionImage));
  appendImages('my_solution', getImages(draft.mySolutionImages, draft.mySolutionImage));
  appendImages('answer', getImages(draft.answerImages, draft.answerImage));

  return images;
}

function serializeIds(ids: readonly string[]): string | undefined {
  const normalized = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  return normalized.length > 0 ? JSON.stringify(normalized) : undefined;
}

function buildDisplayErrorReason(draft: AddMistakeDraft): string | undefined {
  const labels = Array.from(
    new Set(draft.errorReasonLabels.map((label) => label.trim()).filter(Boolean)),
  );
  if (labels.length > 0) {
    return labels.join('、');
  }
  return normalizeOptionalText(draft.errorReason);
}

function buildDraftForBatchQuestion(
  draft: AddMistakeDraft,
  questionImage: AddMistakeDraft['questionImages'][number],
  mistakeId: string,
): AddMistakeDraft {
  return {
    ...draft,
    draftId: mistakeId,
    title: '',
    note: '',
    mySolutionText: '',
    answerText: '',
    questionImages: [questionImage],
    mySolutionImages: [],
    answerImages: [],
    questionImage,
    mySolutionImage: null,
    answerImage: null,
  };
}

async function persistDraft(
  db: SQLite.SQLiteDatabase,
  draft: AddMistakeDraft,
  mistakeId: string,
  questionNo: number | undefined,
  joinReviewPlan: boolean,
  onMistakeCreated?: () => void,
): Promise<number> {
  const { moduleName, moduleId } = resolveDraftModule(draft);

  const questionImageUri = getImages(draft.questionImages, draft.questionImage)[0]?.uri?.trim();
  if (!questionImageUri) {
    throw new Error('题目照片必填。');
  }

  const answerImageUri = normalizeOptionalText(
    getImages(draft.answerImages, draft.answerImage)[0]?.uri,
  ) ?? null;
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
    module_id: moduleId,
    question_no: normalizeQuestionNo(questionNo),
    title: normalizeOptionalText(draft.title) ?? buildCanonicalQuestionTitle(moduleName, questionNo),
    error_reason: buildDisplayErrorReason(draft),
    error_reason_ids: serializeIds(draft.errorReasonIds) ?? null,
    difficulty: draft.difficulty,
    note: normalizeOptionalText(draft.note),
    my_solution_text: normalizeOptionalText(draft.mySolutionText) ?? null,
    answer_text: normalizeOptionalText(draft.answerText) ?? null,
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

  const { moduleId } = resolveDraftModule(draft);

  const reservedQuestionNumbers = await MistakeRepository.reserveNextQuestionNumbersByModuleInTransaction(
    db,
    moduleId,
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
        options?.joinReviewPlan ?? draft.joinReviewPlan,
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

export async function createMistakesFromDraft(
  draft: AddMistakeDraft,
  options?: CreateMistakeFromDraftOptions,
): Promise<CreateMistakesFromDraftResult> {
  const questionImages = getImages(draft.questionImages, draft.questionImage);
  if (questionImages.length <= 1) {
    const result = await createMistakeFromDraft(draft, options);
    return result.ok
      ? { ...result, mistakeIds: result.mistakeId ? [result.mistakeId] : [] }
      : result;
  }

  const validation = validateAddMistakeDraft({
    ...draft,
    questionImages,
    questionImage: questionImages[0] ?? null,
  });
  if (!validation.ok) {
    return { ok: false, errorMessage: validation.errors.join('\n') };
  }

  const { moduleId } = resolveDraftModule(draft);

  const mistakeIds = questionImages.map((_, index) =>
    index === 0 ? draft.draftId : createMistakeId(),
  );
  try {
    await withDatabaseTransaction(async (db) => {
      const questionNumbers = await MistakeRepository.reserveNextQuestionNumbersByModuleInTransaction(
        db,
        moduleId,
        questionImages.length,
      );
      for (let index = 0; index < questionImages.length; index += 1) {
        await persistDraft(
          db,
          buildDraftForBatchQuestion(draft, questionImages[index], mistakeIds[index]),
          mistakeIds[index],
          questionNumbers[index],
          options?.joinReviewPlan ?? draft.joinReviewPlan,
        );
      }
    });

    void ReviewReminderService.refreshReminderSchedule({ reason: 'create_mistake' }).catch((error) => {
      Logger.warn(SERVICE_SCOPE, 'Reminder refresh failed after batch creation.', { error });
    });
    return { ok: true, mistakeId: mistakeIds[0], mistakeIds };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to save batch mistake draft.', { draftId: draft.draftId, error });
    return { ok: false, errorMessage: toErrorMessage(error) || FALLBACK_ERROR_MESSAGE };
  }
}
