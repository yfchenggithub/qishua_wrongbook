import type { MistakeImageType } from '@/src/models/Mistake';

export interface MistakeImage {
  id: string;
  mistake_id: string;
  review_record_id?: string | null;
  type: MistakeImageType;
  uri: string;
  sort_order: number;
  created_at: string;
}

export interface CreateMistakeImageInput {
  mistake_id: string;
  review_record_id?: string | null;
  type: MistakeImageType;
  uri: string;
  sort_order?: number;
}
