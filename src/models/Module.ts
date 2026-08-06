import type { ModuleType } from '@/src/constants/modules';

export interface ModuleRecord {
  id: number;
  type: ModuleType;
  name: string;
  display_code: string;
  custom_no: number | null;
  icon: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ModuleQuestionCounter {
  module_id: number;
  last_question_no: number;
  updated_at: string;
}
