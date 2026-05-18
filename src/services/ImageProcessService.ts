import { Directory, File, Paths } from 'expo-file-system';
import type { Action } from 'expo-image-manipulator';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { Image } from 'react-native';

import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'ImageProcessService';
const OUTPUT_DIR_NAME = 'qishua_images';
const MAX_OUTPUT_NAME_ATTEMPTS = 100;

const SLOT_CONFIG = {
  question: {
    targetMaxWidth: 1400,
    quality: 0.75,
  },
  solution: {
    targetMaxWidth: 1600,
    quality: 0.78,
  },
  answer: {
    targetMaxWidth: 1600,
    quality: 0.78,
  },
} as const;

export type ImageSlot = 'question' | 'solution' | 'answer';

export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface CropAndCompressImageParams {
  sourceUri: string;
  cropRect?: CropRect;
  imageSlot: ImageSlot;
  mistakeId: string;
}

export interface CropAndCompressImageResult {
  uri: string;
  width: number;
  height: number;
  fileSize: number;
}

function normalizeRequiredText(value: string | null | undefined, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`${fieldName} cannot be empty.`);
  }
  return normalized;
}

function toShortUri(uri: string | null | undefined): string | null {
  if (typeof uri !== 'string') {
    return null;
  }

  const normalized = uri.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= 80) {
    return normalized;
  }
  return `${normalized.slice(0, 36)}...${normalized.slice(-28)}`;
}

function sanitizeNamePart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, '_');
  return normalized || 'unknown';
}

function ensureImageSlot(value: string): ImageSlot {
  if (value === 'question' || value === 'solution' || value === 'answer') {
    return value;
  }
  throw new Error(`Unsupported image slot: ${value}`);
}

function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => reject(new Error('Failed to read image size.')),
    );
  });
}

function ensureSourceExists(uri: string): void {
  const file = new File(uri);
  if (!file.exists) {
    throw new Error('Source image does not exist.');
  }
}

function ensureOutputDirectory(): Directory {
  const outputDir = new Directory(Paths.document, OUTPUT_DIR_NAME);
  outputDir.create({ intermediates: true, idempotent: true });
  return outputDir;
}

function buildOutputFile(
  outputDirectory: Directory,
  slot: ImageSlot,
  mistakeId: string,
): File {
  const safeMistakeId = sanitizeNamePart(mistakeId);
  const baseTimestamp = Date.now();

  for (let attempt = 0; attempt < MAX_OUTPUT_NAME_ATTEMPTS; attempt += 1) {
    const stamp = baseTimestamp + attempt;
    const fileName = `${slot}_${safeMistakeId}_${stamp}.jpg`;
    const target = new File(outputDirectory, fileName);
    if (!target.exists) {
      return target;
    }
  }

  const fallbackName = `${slot}_${safeMistakeId}_${baseTimestamp}_${Math.floor(Math.random() * 10000)}.jpg`;
  return new File(outputDirectory, fallbackName);
}

function clamp(numberValue: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, numberValue));
}

function normalizeCropRect(
  cropRect: CropRect,
  imageWidth: number,
  imageHeight: number,
): CropRect | null {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }

  const rawOriginX = Number(cropRect.originX);
  const rawOriginY = Number(cropRect.originY);
  const rawWidth = Number(cropRect.width);
  const rawHeight = Number(cropRect.height);
  if (
    !Number.isFinite(rawOriginX)
    || !Number.isFinite(rawOriginY)
    || !Number.isFinite(rawWidth)
    || !Number.isFinite(rawHeight)
  ) {
    return null;
  }

  if (rawWidth <= 0 || rawHeight <= 0) {
    return null;
  }

  const originX = clamp(rawOriginX, 0, Math.max(0, imageWidth - 1));
  const originY = clamp(rawOriginY, 0, Math.max(0, imageHeight - 1));
  const width = clamp(rawWidth, 1, imageWidth - originX);
  const height = clamp(rawHeight, 1, imageHeight - originY);

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    originX: Math.round(originX),
    originY: Math.round(originY),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function buildResizeAction(
  width: number,
  height: number,
  targetMaxWidth: number,
): Action | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  if (width <= targetMaxWidth) {
    return null;
  }

  const scale = targetMaxWidth / width;
  return {
    resize: {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    },
  };
}

function readFileSizeOrThrow(uri: string): number {
  const info = new File(uri).info();
  const fileSize = typeof info.size === 'number' ? info.size : 0;
  if (!info.exists || fileSize <= 0) {
    throw new Error('Processed image is invalid.');
  }
  return fileSize;
}

function tryDeleteFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to clean temporary image file.', {
      uriShort: toShortUri(uri),
      error,
    });
  }
}

export async function cropAndCompressImage(
  params: CropAndCompressImageParams,
): Promise<CropAndCompressImageResult> {
  const startedAt = Date.now();
  let manipulatedUri: string | null = null;

  try {
    const sourceUri = normalizeRequiredText(params.sourceUri, 'sourceUri');
    const mistakeId = normalizeRequiredText(params.mistakeId, 'mistakeId');
    const imageSlot = ensureImageSlot(params.imageSlot);
    const slotConfig = SLOT_CONFIG[imageSlot];
    ensureSourceExists(sourceUri);

    const originalSize = await getImageDimensions(sourceUri);
    const normalizedCropRect = params.cropRect
      ? normalizeCropRect(params.cropRect, originalSize.width, originalSize.height)
      : null;

    if (params.cropRect && !normalizedCropRect) {
      throw new Error('Invalid crop rect.');
    }

    const processedBaseWidth = normalizedCropRect?.width ?? originalSize.width;
    const processedBaseHeight = normalizedCropRect?.height ?? originalSize.height;
    const resizeAction = buildResizeAction(
      processedBaseWidth,
      processedBaseHeight,
      slotConfig.targetMaxWidth,
    );

    const actions: Action[] = [];
    if (normalizedCropRect) {
      actions.push({ crop: normalizedCropRect });
    }
    if (resizeAction) {
      actions.push(resizeAction);
    }

    Logger.info(SERVICE_SCOPE, 'Start crop/compress image.', {
      mistakeId,
      imageSlot,
      sourceUriShort: toShortUri(sourceUri),
      sourceWidth: originalSize.width,
      sourceHeight: originalSize.height,
      cropRect: normalizedCropRect ?? null,
      resizeAction: resizeAction ?? null,
      quality: slotConfig.quality,
    });

    const manipulated = await manipulateAsync(sourceUri, actions, {
      compress: slotConfig.quality,
      format: SaveFormat.JPEG,
      base64: false,
    });
    manipulatedUri = normalizeRequiredText(manipulated.uri, 'manipulatedUri');

    const manipulatedFile = new File(manipulatedUri);
    if (!manipulatedFile.exists) {
      throw new Error('Image processing output does not exist.');
    }

    const outputDirectory = ensureOutputDirectory();
    const outputFile = buildOutputFile(outputDirectory, imageSlot, mistakeId);
    manipulatedFile.copy(outputFile);

    const outputSize = readFileSizeOrThrow(outputFile.uri);
    const outputDimensions = await getImageDimensions(outputFile.uri);

    Logger.info(SERVICE_SCOPE, 'Crop/compress image succeeded.', {
      mistakeId,
      imageSlot,
      outputUriShort: toShortUri(outputFile.uri),
      outputWidth: outputDimensions.width,
      outputHeight: outputDimensions.height,
      outputFileSize: outputSize,
      durationMs: Date.now() - startedAt,
    });

    return {
      uri: outputFile.uri,
      width: outputDimensions.width,
      height: outputDimensions.height,
      fileSize: outputSize,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Crop/compress image failed.', {
      imageSlot: params.imageSlot,
      mistakeId: params.mistakeId,
      sourceUriShort: toShortUri(params.sourceUri),
      hasCropRect: !!params.cropRect,
      error,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  } finally {
    if (manipulatedUri && manipulatedUri !== params.sourceUri) {
      tryDeleteFile(manipulatedUri);
    }
  }
}
