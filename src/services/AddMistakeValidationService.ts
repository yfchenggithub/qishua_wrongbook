import {
  DIFFICULTY_OPTIONS,
  MISTAKE_NOTE_MAX_LENGTH,
  SUBJECT_OPTIONS,
} from '@/src/constants/mistakeOptions';
import type {
  AddMistakeDraft,
  AddMistakeValidationResult,
} from '@/src/models/AddMistakeDraft';
import { createMistakeId } from '@/src/utils/id';

const DEFAULT_SUBJECT = SUBJECT_OPTIONS[0]?.value ?? 'math';
const DEFAULT_DIFFICULTY = 3;
const MIN_DIFFICULTY = DIFFICULTY_OPTIONS[0]?.value ?? 1;
const MAX_DIFFICULTY = DIFFICULTY_OPTIONS[DIFFICULTY_OPTIONS.length - 1]?.value ?? 5;

function hasValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function createEmptyAddMistakeDraft(): AddMistakeDraft {
  return {
    draftId: createMistakeId(),
    subject: DEFAULT_SUBJECT,
    module: null,
    title: '',
    errorReason: null,
    difficulty: DEFAULT_DIFFICULTY,
    note: '',
    questionImage: null,
    mySolutionImage: null,
    answerImage: null,
    createdAt: new Date().toISOString(),
  };
}

export function validateAddMistakeDraft(draft: AddMistakeDraft): AddMistakeValidationResult {
  const errors: string[] = [];

  if (!draft.questionImage) {
    errors.push('题目照片必填，请先拍摄或选择题目照片。');
  }

  if (!hasValue(draft.module)) {
    errors.push('模块必填，请先选择模块。');
  }

  if (
    !Number.isInteger(draft.difficulty) ||
    draft.difficulty < MIN_DIFFICULTY ||
    draft.difficulty > MAX_DIFFICULTY
  ) {
    errors.push(`难度必须是 ${MIN_DIFFICULTY}-${MAX_DIFFICULTY} 的整数。`);
  }

  if (typeof draft.note === 'string' && draft.note.length > MISTAKE_NOTE_MAX_LENGTH) {
    errors.push(`备注不能超过 ${MISTAKE_NOTE_MAX_LENGTH} 字。`);
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
