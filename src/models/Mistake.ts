export type MistakeStatus = 'active' | 'mastered' | 'archived';

export type MistakeImageType = 'question' | 'my_solution' | 'answer' | 'review_solution';

export type ReviewResult = 'done' | 'still_wrong' | 'too_easy';

export interface Mistake {
  id: string;
  subject: string;
  module: string;
  title?: string | null;
  error_reason?: string | null;
  difficulty: number;
  question_image_uri?: string | null;
  answer_image_uri?: string | null;
  note?: string | null;
  review_count: number;
  status: MistakeStatus;
  created_at: string;
  updated_at: string;
  next_review_at?: string | null;
}

export interface CreateMistakeInput {
  module: string;
  title?: string;
  error_reason?: string;
  difficulty?: number;
  question_image_uri?: string | null;
  answer_image_uri?: string | null;
  note?: string | null;
  subject?: string;
  next_review_at?: string | null;
}

export interface UpdateMistakeInput {
  subject?: string;
  module?: string;
  title?: string | null;
  error_reason?: string | null;
  difficulty?: number;
  question_image_uri?: string | null;
  answer_image_uri?: string | null;
  note?: string | null;
  review_count?: number;
  status?: MistakeStatus;
  next_review_at?: string | null;
  updated_at?: string;
}
