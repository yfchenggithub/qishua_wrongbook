import type { ImageType } from '@/src/models/Mistake';

export type LocalImageType = ImageType;

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

export interface PickedImageAsset {
  tempUri: string;
  width?: number;
  height?: number;
  fileSize?: number | null;
}

export interface PickedImagesResult {
  canceled: boolean;
  assets?: PickedImageAsset[];
  errorMessage?: string;
}

export interface SavedImageResult {
  ok: boolean;
  image?: LocalImage;
  errorMessage?: string;
}
