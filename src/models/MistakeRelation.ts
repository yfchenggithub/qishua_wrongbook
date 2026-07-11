export type MistakeRelationSource = 'system' | 'manual';

export interface MistakeRelation {
  id: string;
  source_mistake_id: string;
  target_mistake_id: string;
  source: MistakeRelationSource;
  created_at: string;
}

export interface CreateMistakeRelationInput {
  sourceMistakeId: string;
  targetMistakeId: string;
  source: MistakeRelationSource;
}

export interface MistakeRelationSummary {
  total: number;
  system: number;
  manual: number;
}
