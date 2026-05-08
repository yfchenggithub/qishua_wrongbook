import { getDatabase } from '@/src/db';
import type { AddMistakeDraft } from '@/src/models/AddMistakeDraft';
import type { MistakeImageType } from '@/src/models/Mistake';
import { MistakeImageRepository, MistakeRepository } from '@/src/repositories';
import { validateAddMistakeDraft } from '@/src/services/AddMistakeValidationService';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'CreateMistakeService';
const DEFAULT_SUBJECT = 'math';
const FALLBACK_ERROR_MESSAGE = '保存错题失败，请稍后重试。';

type TransactionCapableDatabase = {
  withTransactionAsync?: (task: () => Promise<void>) => Promise<void>;
};

type CreateMistakeFromDraftResult = {
  ok: boolean;
  mistakeId?: string;
  errorMessage?: string;
};

type MistakeImageInput = {
  type: MistakeImageType;
  uri: string;
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

function collectImageInputs(draft: AddMistakeDraft): MistakeImageInput[] {
  const images: MistakeImageInput[] = [];

  const questionUri = draft.questionImage?.uri?.trim();
  if (questionUri) {
    images.push({
      type: 'question',
      uri: questionUri,
    });
  }

  const mySolutionUri = draft.mySolutionImage?.uri?.trim();
  if (mySolutionUri) {
    images.push({
      type: 'my_solution',
      uri: mySolutionUri,
    });
  }

  const answerUri = draft.answerImage?.uri?.trim();
  if (answerUri) {
    images.push({
      type: 'answer',
      uri: answerUri,
    });
  }

  return images;
}

async function persistDraft(
  draft: AddMistakeDraft,
  mistakeId: string,
  onMistakeCreated?: () => void,
): Promise<void> {
  const moduleName = draft.module?.trim();
  if (!moduleName) {
    throw new Error('模块不能为空。');
  }

  const questionImageUri = draft.questionImage?.uri?.trim();
  if (!questionImageUri) {
    throw new Error('题目照片必填。');
  }

  const answerImageUri = normalizeOptionalText(draft.answerImage?.uri) ?? null;

  await MistakeRepository.createMistake({
    id: mistakeId,
    subject: draft.subject?.trim() || DEFAULT_SUBJECT,
    module: moduleName,
    title: normalizeOptionalText(draft.title),
    error_reason: normalizeOptionalText(draft.errorReason),
    difficulty: draft.difficulty,
    question_image_uri: questionImageUri,
    answer_image_uri: answerImageUri,
    note: normalizeOptionalText(draft.note),
    next_review_at: new Date().toISOString(),
  });
  onMistakeCreated?.();

  const imageInputs = collectImageInputs(draft);
  for (const image of imageInputs) {
    await MistakeImageRepository.createMistakeImage({
      mistake_id: mistakeId,
      type: image.type,
      uri: image.uri,
    });
  }
}

export async function createMistakeFromDraft(
  draft: AddMistakeDraft,
): Promise<CreateMistakeFromDraftResult> {
  const validation = validateAddMistakeDraft(draft);
  if (!validation.ok) {
    return {
      ok: false,
      errorMessage: validation.errors.join('\n'),
    };
  }

  const mistakeId = typeof draft.draftId === 'string' ? draft.draftId.trim() : '';
  if (!mistakeId) {
    return {
      ok: false,
      errorMessage: 'draftId 不能为空。',
    };
  }

  let mistakeCreated = false;

  try {
    const db = (await getDatabase()) as TransactionCapableDatabase;
    const runPersistFlow = async () => {
      await persistDraft(draft, mistakeId, () => {
        mistakeCreated = true;
      });
    };

    if (typeof db.withTransactionAsync === 'function') {
      await db.withTransactionAsync(runPersistFlow);
    } else {
      // Fallback path without transaction wrapper.
      // If any later step fails, we try compensating cleanup on the created mistake row.
      await runPersistFlow();
    }

    return {
      ok: true,
      mistakeId,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'createMistakeFromDraft failed.', {
      mistakeId,
      error,
    });

    if (mistakeCreated) {
      try {
        await MistakeRepository.deleteMistake(mistakeId);
      } catch (rollbackError) {
        Logger.error(SERVICE_SCOPE, 'Compensating rollback failed.', {
          mistakeId,
          rollbackError,
        });
      }
    }

    return {
      ok: false,
      errorMessage: toErrorMessage(error) || FALLBACK_ERROR_MESSAGE,
    };
  }
}
