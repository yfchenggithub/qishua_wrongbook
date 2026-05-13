import type { ReviewResult } from '@/src/models/Mistake';

export interface ReviewRecord {
  id: string;
  mistake_id: string;
  review_index: number;
  /** @deprecated Legacy compatibility only. Do not read/write in business logic. */
  solution_image_uri?: string | null;
  result: ReviewResult;
  note?: string | null;
  created_at: string;
}

export interface CreateReviewRecordInput {
  mistake_id: string;
  review_index: number;
  /** @deprecated Legacy compatibility only. Do not read/write in business logic. */
  solution_image_uri?: string | null;
  result: ReviewResult;
  note?: string | null;
}
