export type MistakeStatus = 'collected' | 'active' | 'mastered' | 'archived';

export type ImageType = 'question' | 'my_solution' | 'answer' | 'review_solution';
export type MistakeImageType = ImageType;

export type ReviewResult = 'mastered' | 'unsure' | 'wrong';

export interface Mistake {
  id: string;
  subject: string;
  module: string;
  module_id?: string | null;
  title?: string | null;
  error_reason?: string | null;
  error_reason_ids?: string | null;
  difficulty: number;
  note?: string | null;
  my_solution_text?: string | null;
  answer_text?: string | null;
  note_highlights?: string | null;
  review_count: number;
  status: MistakeStatus;
  created_at: string;
  updated_at: string;
  next_review_at?: string | null;
  last_review_at?: string | null;
  last_review_result?: ReviewResult | null;
  is_pinned: boolean;
  last_viewed_at?: string | null;
}

export interface CreateMistakeInput {
  id?: string;
  module: string;
  module_id?: string | null;
  title?: string;
  error_reason?: string;
  error_reason_ids?: string | null;
  difficulty?: number;
  note?: string | null;
  my_solution_text?: string | null;
  answer_text?: string | null;
  note_highlights?: string | null;
  subject?: string;
  status?: MistakeStatus;
  next_review_at?: string | null;
  last_review_at?: string | null;
  last_review_result?: ReviewResult | null;
  is_pinned?: boolean;
  last_viewed_at?: string | null;
}

export interface UpdateMistakeInput {
  subject?: string;
  module?: string;
  module_id?: string | null;
  title?: string | null;
  error_reason?: string | null;
  error_reason_ids?: string | null;
  difficulty?: number;
  note?: string | null;
  my_solution_text?: string | null;
  answer_text?: string | null;
  note_highlights?: string | null;
  review_count?: number;
  status?: MistakeStatus;
  next_review_at?: string | null;
  last_review_at?: string | null;
  last_review_result?: ReviewResult | null;
  is_pinned?: boolean;
  last_viewed_at?: string | null;
  updated_at?: string;
}
