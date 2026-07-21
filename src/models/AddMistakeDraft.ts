import type { LocalImage } from '@/src/models/LocalImage';

export interface AddMistakeDraft {
  draftId: string;
  subject: string;
  moduleId: string | null;
  module: string | null;
  title: string;
  errorReasonIds: string[];
  errorReasonLabels: string[];
  errorReason: string | null;
  difficulty: number;
  note: string;
  mySolutionText: string;
  answerText: string;
  questionImages: LocalImage[];
  mySolutionImages: LocalImage[];
  answerImages: LocalImage[];
  joinReviewPlan: boolean;
  /** Backward-compatible primary-image aliases. */
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
