import { File } from 'expo-file-system';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { Image } from 'react-native';

import {
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  IMAGE_QUALITY,
} from '@/src/constants/image';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'ImageOptimizeService';

export interface OptimizeImageParams {
  uri: string;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

export interface OptimizeImageResult {
  ok: boolean;
  uri?: string;
  width?: number;
  height?: number;
  fileSize?: number | null;
  errorMessage?: string;
}

function normalizeMaxSize(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return value > 0 ? value : fallback;
}

function normalizeQuality(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return IMAGE_QUALITY;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error),
    );
  });
}

function computeResizeSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } | null {
  if (width <= maxWidth && height <= maxHeight) {
    return null;
  }

  const scale = Math.min(maxWidth / width, maxHeight / height);
  const nextWidth = Math.max(1, Math.round(width * scale));
  const nextHeight = Math.max(1, Math.round(height * scale));

  return {
    width: nextWidth,
    height: nextHeight,
  };
}

function safeReadFileSize(uri: string): number | null {
  try {
    const fileInfo = new File(uri).info();
    return typeof fileInfo.size === 'number' ? fileInfo.size : null;
  } catch {
    return null;
  }
}

export async function optimizeImageForStorage(
  params: OptimizeImageParams,
): Promise<OptimizeImageResult> {
  try {
    const maxWidth = normalizeMaxSize(params.maxWidth, IMAGE_MAX_WIDTH);
    const maxHeight = normalizeMaxSize(params.maxHeight, IMAGE_MAX_HEIGHT);
    const quality = normalizeQuality(params.quality);

    const original = await getImageDimensions(params.uri);
    const resize = computeResizeSize(
      original.width,
      original.height,
      maxWidth,
      maxHeight,
    );

    const actions = resize ? [{ resize }] : [];
    const optimized = await manipulateAsync(params.uri, actions, {
      compress: quality,
      format: SaveFormat.JPEG,
      base64: false,
    });

    const fileSize = safeReadFileSize(optimized.uri);

    Logger.info(SERVICE_SCOPE, 'Image optimized for storage.', {
      sourceUri: params.uri,
      optimizedUri: optimized.uri,
      originalWidth: original.width,
      originalHeight: original.height,
      optimizedWidth: optimized.width,
      optimizedHeight: optimized.height,
      resized: Boolean(resize),
      quality,
      fileSize,
    });

    return {
      ok: true,
      uri: optimized.uri,
      width: optimized.width,
      height: optimized.height,
      fileSize,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to optimize image for storage.', {
      params,
      error,
    });
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
