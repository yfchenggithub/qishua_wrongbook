import type { LocalImage } from '@/src/models/LocalImage';

export interface AddMistakeDraft {
  draftId: string;
  subject: string;
  module: string | null;
  title: string;
  errorReason: string | null;
  difficulty: number;
  note: string;
  questionImage: LocalImage | null;
  mySolutionImage: LocalImage | null;
  answerImage: LocalImage | null;
  createdAt: string;
}

export interface AddMistakeValidationResult {
  ok: boolean;
  errors: string[];
}

export interface CreateMistakeFromDraftInput {
  draft: AddMistakeDraft;
}
