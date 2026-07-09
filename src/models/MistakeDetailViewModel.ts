import type { MistakeStatus, ReviewResult } from '@/src/models/Mistake';
import type { ReviewRecordVoiceNote } from '@/src/models/ReviewRecord';

export type DetailImageSlotType =
  | 'question'
  | 'my_solution'
  | 'answer'
  | 'review_solution';

export interface DetailPreviewImageItem {
  id: string;
  uri: string;
  exists?: boolean;
  fileSize?: number | null;
}

export interface DetailImageSlot {
  type: DetailImageSlotType;
  title: string;
  uri?: string | null;
  exists?: boolean;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  emptyText: string;
  previewImages?: DetailPreviewImageItem[];
}

export type DetailReviewResult = ReviewResult | 'known' | 'vague' | 'unknown' | null;

export interface DetailReviewRecordItem {
  id: string;
  reviewIndex: number;
  createdAt: string;
  result: DetailReviewResult;
  note?: string | null;
  voiceNote?: ReviewRecordVoiceNote | null;
  solutionImageId?: string | null;
  solutionImageUri?: string | null;
  solutionImageExists?: boolean;
  solutionImages?: DetailPreviewImageItem[];
}

export interface MistakeDetailViewModel {
  id: string;
  module: string;
  title: string;
  subtitle: string;
  errorReason?: string | null;
  difficulty: number;
  note?: string | null;
  reviewCount: number;
  maxReviewCount: number;
  status: MistakeStatus;
  statusLabel: string;
  nextReviewAt?: string | null;
  createdAt: string;
  updatedAt: string;
  imageSlots: DetailImageSlot[];
  reviewRecords: DetailReviewRecordItem[];
}
