import type { ReviewResult } from '@/src/models/Mistake';

export interface ReviewRecord {
  id: string;
  mistake_id: string;
  review_index: number;
  result: string | null;
  note?: string | null;
  created_at: string;
}

export interface CreateReviewRecordInput {
  mistake_id: string;
  review_index: number;
  result: ReviewResult;
  note?: string | null;
}
