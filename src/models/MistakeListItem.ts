import type { MistakeStatus } from '@/src/models/Mistake';
import type { MistakeTag } from '@/src/models/MistakeTag';

export type MistakeListStatus = 'collected' | 'due_today' | 'upcoming' | 'mastered' | 'archived';

export interface MistakeListItem {
  id: string;
  module: string;
  questionCode: string;
  title: string;
  subtitle: string;
  errorReason?: string | null;
  tags: MistakeTag[];
  difficulty: number;
  thumbnailUri?: string | null;
  reviewCount: number;
  maxReviewCount: number;
  status: MistakeStatus;
  displayStatus: MistakeListStatus;
  statusLabel: string;
  nextReviewAt?: string | null;
  lastReviewAt?: string | null;
  createdAt: string;
  updatedAt: string;
  isPinned: boolean;
  lastViewedAt?: string | null;
}

export interface MistakeListFilter {
  segment: 'all' | 'collected' | 'due' | 'mastered';
  keyword: string;
  module?: string | null;
  tagKeys?: string[];
  limit?: number | null;
}
