import type { MistakeStatus, ReviewResult } from '@/src/models/Mistake';
import type { MistakeRelationSummary } from '@/src/models/MistakeRelation';
import type { MistakeTag } from '@/src/models/MistakeTag';
import type { ReviewRecordVoiceNote } from '@/src/models/ReviewRecord';
import type { TextHighlightRange } from '@/src/models/TextHighlight';

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
  noteHighlights?: TextHighlightRange[];
  voiceNote?: ReviewRecordVoiceNote | null;
  solutionImageId?: string | null;
  solutionImageUri?: string | null;
  solutionImageExists?: boolean;
  solutionImages?: DetailPreviewImageItem[];
}

export interface MistakeDetailViewModel {
  id: string;
  module: string;
  moduleId: number;
  title: string;
  subtitle: string;
  errorReason?: string | null;
  errorReasonIds?: string[];
  difficulty: number;
  note?: string | null;
  mySolutionText?: string | null;
  answerText?: string | null;
  noteHighlights?: TextHighlightRange[];
  reviewCount: number;
  maxReviewCount: number;
  status: MistakeStatus;
  statusLabel: string;
  nextReviewAt?: string | null;
  createdAt: string;
  updatedAt: string;
  tags: MistakeTag[];
  imageSlots: DetailImageSlot[];
  reviewRecords: DetailReviewRecordItem[];
  relatedSummary: MistakeRelationSummary;
}
