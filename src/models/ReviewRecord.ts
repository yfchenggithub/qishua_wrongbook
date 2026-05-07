import type { ReviewResult } from '@/src/models/Mistake';

export interface ReviewRecord {
  id: string;
  mistake_id: string;
  review_index: number;
  solution_image_uri?: string | null;
  result: ReviewResult;
  created_at: string;
}

export interface CreateReviewRecordInput {
  mistake_id: string;
  review_index: number;
  solution_image_uri?: string | null;
  result?: ReviewResult;
}
