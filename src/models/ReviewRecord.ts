import type { ReviewResult } from '@/src/models/Mistake';

export interface ReviewRecordVoiceNote {
  id: string;
  fileUri: string;
  fileName: string;
  durationMs: number;
  sizeBytes: number;
  createdAt: string;
}

export interface ReviewRecord {
  id: string;
  mistake_id: string;
  review_index: number;
  result: string | null;
  note?: string | null;
  note_highlights?: string | null;
  voice_note?: ReviewRecordVoiceNote | null;
  created_at: string;
}

export interface CreateReviewRecordInput {
  mistake_id: string;
  review_index: number;
  result: ReviewResult;
  note?: string | null;
  note_highlights?: string | null;
  voice_note?: ReviewRecordVoiceNote | null;
}
