export type LocalImageType = 'question' | 'my_solution' | 'answer' | 'review_solution';

export interface LocalImage {
  id: string;
  mistakeId: string;
  type: LocalImageType;
  uri: string;
  fileName: string;
  directory: string;
  createdAt: string;
  width?: number;
  height?: number;
  fileSize?: number | null;
}

export interface PickedImageResult {
  canceled: boolean;
  tempUri?: string;
  width?: number;
  height?: number;
  fileSize?: number | null;
  errorMessage?: string;
}

export interface SavedImageResult {
  ok: boolean;
  image?: LocalImage;
  errorMessage?: string;
}
