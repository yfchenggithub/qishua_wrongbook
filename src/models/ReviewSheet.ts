export interface ReviewSheet {
  id: string;
  created_at: string;
  submitted_at?: string | null;
  is_submitted: number;
}

export interface ReviewSheetItem {
  id: string;
  sheet_id: string;
  mistake_id: string;
  sort_order: number;
  created_at: string;
}

export interface ReviewSheetWithItems extends ReviewSheet {
  items: ReviewSheetItem[];
}
