import type { MistakeStatus } from '@/src/models/Mistake';

export type MistakeListStatus = 'due_today' | 'upcoming' | 'mastered' | 'archived';

export interface MistakeListItem {
  id: string;
  module: string;
  title: string;
  subtitle: string;
  errorReason?: string | null;
  difficulty: number;
  thumbnailUri?: string | null;
  reviewCount: number;
  maxReviewCount: number;
  status: MistakeStatus;
  displayStatus: MistakeListStatus;
  statusLabel: string;
  nextReviewAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MistakeListFilter {
  segment: 'all' | 'due' | 'mastered';
  keyword: string;
  module?: string | null;
}
