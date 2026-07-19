export interface CustomErrorReason {
  id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomErrorReasonInput {
  id?: string;
  name: string;
  icon?: string;
  color?: string;
}

export interface UpdateCustomErrorReasonInput {
  name?: string;
  icon?: string;
  color?: string;
}
