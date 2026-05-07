import type { MistakeImageType } from '@/src/models/Mistake';

export interface MistakeImage {
  id: string;
  mistake_id: string;
  type: MistakeImageType;
  uri: string;
  created_at: string;
}

export interface CreateMistakeImageInput {
  mistake_id: string;
  type: MistakeImageType;
  uri: string;
}
