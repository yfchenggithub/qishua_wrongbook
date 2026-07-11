import type { MistakeStatus } from '@/src/models/Mistake';
import type { MistakeRelationSource } from '@/src/models/MistakeRelation';

export interface RelatedMistakeSourceInfo {
  id: string;
  title: string;
  module: string;
}

export interface RelatedMistakeItem {
  id: string;
  title: string;
  module: string;
  errorReason?: string | null;
  difficulty: number;
  thumbnailUri?: string | null;
  reviewCount: number;
  maxReviewCount: number;
  status: MistakeStatus;
  createdAt: string;
  updatedAt: string;
  relationId?: string | null;
  relationSource?: MistakeRelationSource | null;
  relationCreatedAt?: string | null;
  matchReasons: string[];
  score?: number | null;
}

export interface RelatedMistakeSummary {
  total: number;
  system: number;
  manual: number;
}
