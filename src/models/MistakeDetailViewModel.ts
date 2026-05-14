import type { MistakeStatus, ReviewResult } from '@/src/models/Mistake';

export type DetailImageSlotType =
  | 'question'
  | 'my_solution'
  | 'answer'
  | 'review_solution';

export interface DetailImageSlot {
  type: DetailImageSlotType;
  title: string;
  uri?: string | null;
  exists?: boolean;
  fileSize?: number | null;
  emptyText: string;
}

export type DetailReviewResult = ReviewResult | 'known' | 'vague' | 'unknown' | null;

export interface DetailReviewRecordItem {
  id: string;
  reviewIndex: number;
  createdAt: string;
  result: DetailReviewResult;
  solutionImageUri?: string | null;
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
