export interface MistakeTag {
  id: string;
  mistake_id: string;
  name: string;
  normalized_name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateMistakeTagInput {
  mistakeId: string;
  name: string;
  normalizedName: string;
}
