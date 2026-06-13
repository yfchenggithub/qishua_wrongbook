export interface CustomModule {
  id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomModuleInput {
  id?: string;
  name: string;
  icon?: string;
  color?: string;
}

export interface UpdateCustomModuleInput {
  name?: string;
  icon?: string;
  color?: string;
}
