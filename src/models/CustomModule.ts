export interface CustomModule {
  id: number;
  name: string;
  display_code: string;
  custom_no: number;
  icon: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomModuleInput {
  name: string;
  icon?: string;
  color?: string;
}

export interface UpdateCustomModuleInput {
  name?: string;
  icon?: string;
  color?: string;
}
