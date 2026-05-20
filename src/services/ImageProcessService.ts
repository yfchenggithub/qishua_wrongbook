import { Directory, File, Paths } from 'expo-file-system';
import type { Action } from 'expo-image-manipulator';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { Image } from 'react-native';

import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'ImageProcessService';
const OUTPUT_DIR_NAME = 'qishua_images';
const MAX_OUTPUT_NAME_ATTEMPTS = 100;
const ROTATE_NOOP_DEGREES_EPSILON = 0.05;

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
  sourceSizeHint?: {
    width: number;
    height: number;
  };
  debugSessionId?: string;
}

export interface CropAndCompressImageResult {
  uri: string;
  width: number;
  height: number;
  fileSize: number;
}

export interface PreparedCropSourceImage {
  uri: string;
  width: number;
  height: number;
  isTemporary: boolean;
}

export interface ImageGeometryDiagnostics {
  sourceUri: string;
  sourceExists: boolean;
  sourceFileSize: number | null;
  getSizeWidth: number | null;
  getSizeHeight: number | null;
  manipulatorWidth: number | null;
  manipulatorHeight: number | null;
  manipulatorError: string | null;
}

export interface CropDebugProbeParams {
  sourceUri: string;
  cropRect: CropRect;
  sourceSizeHint?: {
    width: number;
    height: number;
  };
  debugSessionId?: string;
}

export interface CropDebugProbeResult {
  uri: string;
  width: number;
  height: number;
  fileSize: number;
  sourceSizeUsed: {
    width: number;
    height: number;
  };
  sourceSizeMeasured: {
    width: number;
    height: number;
  };
  normalizedCropRect: CropRect;
}

export interface RotateImageForEditingParams {
  sourceUri: string;
  rotateDegrees: number;
  debugSessionId?: string;
}

export interface RotateImageForEditingResult {
  uri: string;
  width: number;
  height: number;
  fileSize: number;
  isTemporary: boolean;
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

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) {
      return message;
    }
  }
  return String(error);
}

function normalizeImageSizeHint(
  sizeHint: { width: number; height: number } | null | undefined,
): { width: number; height: number } | null {
  if (!sizeHint) {
    return null;
  }
  const width = Number(sizeHint.width);
  const height = Number(sizeHint.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
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

export async function collectImageGeometryDiagnostics(
  sourceUriInput: string,
): Promise<ImageGeometryDiagnostics> {
  const sourceUri = normalizeRequiredText(sourceUriInput, 'sourceUri');
  const sourceFile = new File(sourceUri);
  const sourceInfo = sourceFile.info();

  let getSizeWidth: number | null = null;
  let getSizeHeight: number | null = null;
  try {
    const sizeFromGetSize = await getImageDimensions(sourceUri);
    getSizeWidth = sizeFromGetSize.width;
    getSizeHeight = sizeFromGetSize.height;
  } catch {
    getSizeWidth = null;
    getSizeHeight = null;
  }

  let manipulatorWidth: number | null = null;
  let manipulatorHeight: number | null = null;
  let manipulatorError: string | null = null;
  let temporaryUriToCleanup: string | null = null;

  try {
    const manipulated = await manipulateAsync(sourceUri, [], {
      compress: 1,
      format: SaveFormat.JPEG,
      base64: false,
    });
    const manipulatedUri = normalizeRequiredText(manipulated.uri, 'manipulatedUri');
    temporaryUriToCleanup = manipulatedUri !== sourceUri ? manipulatedUri : null;

    const width = Number(manipulated.width);
    const height = Number(manipulated.height);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      manipulatorWidth = Math.round(width);
      manipulatorHeight = Math.round(height);
    } else {
      manipulatorError = 'Manipulator returned invalid dimensions.';
    }
  } catch (error) {
    manipulatorError = errorToMessage(error);
  } finally {
    if (temporaryUriToCleanup) {
      tryDeleteFile(temporaryUriToCleanup);
    }
  }

  return {
    sourceUri,
    sourceExists: sourceInfo.exists,
    sourceFileSize: typeof sourceInfo.size === 'number' ? sourceInfo.size : null,
    getSizeWidth,
    getSizeHeight,
    manipulatorWidth,
    manipulatorHeight,
    manipulatorError,
  };
}

export async function prepareCropSourceImage(
  sourceUriInput: string,
): Promise<PreparedCropSourceImage> {
  const startedAt = Date.now();
  const sourceUri = normalizeRequiredText(sourceUriInput, 'sourceUri');
  ensureSourceExists(sourceUri);

  try {
    const prepared = await manipulateAsync(sourceUri, [], {
      // Use maximum quality to avoid introducing visible artifacts before crop.
      compress: 1,
      format: SaveFormat.JPEG,
      base64: false,
    });
    const preparedUri = normalizeRequiredText(prepared.uri, 'preparedUri');
    const preparedFile = new File(preparedUri);
    if (!preparedFile.exists) {
      throw new Error('Prepared crop source image does not exist.');
    }

    const width = Number(prepared.width);
    const height = Number(prepared.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error('Prepared crop source image dimensions are invalid.');
    }

    Logger.info(SERVICE_SCOPE, 'Prepared crop source image.', {
      sourceUriShort: toShortUri(sourceUri),
      preparedUriShort: toShortUri(preparedUri),
      width,
      height,
      isTemporary: preparedUri !== sourceUri,
      durationMs: Date.now() - startedAt,
    });

    return {
      uri: preparedUri,
      width,
      height,
      isTemporary: preparedUri !== sourceUri,
    };
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Prepare crop source image failed, fallback to original image.', {
      sourceUriShort: toShortUri(sourceUri),
      error,
    });

    const fallbackSize = await getImageDimensions(sourceUri);
    return {
      uri: sourceUri,
      width: fallbackSize.width,
      height: fallbackSize.height,
      isTemporary: false,
    };
  }
}

export async function rotateImageForEditing(
  params: RotateImageForEditingParams,
): Promise<RotateImageForEditingResult> {
  const startedAt = Date.now();
  let manipulatedUri: string | null = null;

  try {
    const sourceUri = normalizeRequiredText(params.sourceUri, 'sourceUri');
    ensureSourceExists(sourceUri);

    const rotateDegreesRaw = Number(params.rotateDegrees);
    if (!Number.isFinite(rotateDegreesRaw)) {
      throw new Error('Rotate degrees is invalid.');
    }
    const rotateDegrees =
      Math.abs(rotateDegreesRaw) < ROTATE_NOOP_DEGREES_EPSILON ? 0 : rotateDegreesRaw;

    if (rotateDegrees === 0) {
      const sourceSize = await getImageDimensions(sourceUri);
      const sourceFileSize = readFileSizeOrThrow(sourceUri);
      Logger.info(SERVICE_SCOPE, 'Skip rotate image because angle is near zero.', {
        debugSessionId: params.debugSessionId ?? null,
        sourceUriShort: toShortUri(sourceUri),
        rotateDegreesRaw,
        durationMs: Date.now() - startedAt,
      });
      return {
        uri: sourceUri,
        width: sourceSize.width,
        height: sourceSize.height,
        fileSize: sourceFileSize,
        isTemporary: false,
      };
    }

    Logger.info(SERVICE_SCOPE, 'Start rotate image for editing.', {
      debugSessionId: params.debugSessionId ?? null,
      sourceUriShort: toShortUri(sourceUri),
      rotateDegrees,
    });

    const manipulated = await manipulateAsync(sourceUri, [{ rotate: rotateDegrees }], {
      compress: 1,
      format: SaveFormat.JPEG,
      base64: false,
    });
    manipulatedUri = normalizeRequiredText(manipulated.uri, 'manipulatedUri');

    const outputFileSize = readFileSizeOrThrow(manipulatedUri);
    const outputWidth = Number(manipulated.width);
    const outputHeight = Number(manipulated.height);
    if (!Number.isFinite(outputWidth) || !Number.isFinite(outputHeight) || outputWidth <= 0 || outputHeight <= 0) {
      throw new Error('Rotated image dimensions are invalid.');
    }

    Logger.info(SERVICE_SCOPE, 'Rotate image for editing succeeded.', {
      debugSessionId: params.debugSessionId ?? null,
      sourceUriShort: toShortUri(sourceUri),
      outputUriShort: toShortUri(manipulatedUri),
      rotateDegrees,
      outputWidth,
      outputHeight,
      outputFileSize,
      durationMs: Date.now() - startedAt,
    });

    return {
      uri: manipulatedUri,
      width: Math.round(outputWidth),
      height: Math.round(outputHeight),
      fileSize: outputFileSize,
      isTemporary: manipulatedUri !== sourceUri,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Rotate image for editing failed.', {
      debugSessionId: params.debugSessionId ?? null,
      sourceUriShort: toShortUri(params.sourceUri),
      rotateDegrees: params.rotateDegrees,
      error,
      durationMs: Date.now() - startedAt,
    });
    if (manipulatedUri && manipulatedUri !== params.sourceUri) {
      tryDeleteFile(manipulatedUri);
    }
    throw error;
  }
}

export async function runCropDebugProbe(
  params: CropDebugProbeParams,
): Promise<CropDebugProbeResult> {
  const sourceUri = normalizeRequiredText(params.sourceUri, 'sourceUri');
  ensureSourceExists(sourceUri);

  const sourceSizeMeasured = await getImageDimensions(sourceUri);
  const sourceSizeHint = normalizeImageSizeHint(params.sourceSizeHint);
  const sourceSizeUsed = sourceSizeHint ?? sourceSizeMeasured;
  const normalizedCropRect = normalizeCropRect(
    params.cropRect,
    sourceSizeUsed.width,
    sourceSizeUsed.height,
  );
  if (!normalizedCropRect) {
    throw new Error('Invalid crop rect for debug probe.');
  }

  Logger.info(SERVICE_SCOPE, 'Start crop debug probe.', {
    debugSessionId: params.debugSessionId ?? null,
    sourceUriShort: toShortUri(sourceUri),
    sourceSizeHint: sourceSizeHint ?? null,
    sourceSizeMeasured,
    sourceSizeUsed,
    inputCropRect: params.cropRect,
    normalizedCropRect,
  });

  const manipulated = await manipulateAsync(sourceUri, [{ crop: normalizedCropRect }], {
    compress: 1,
    format: SaveFormat.JPEG,
    base64: false,
  });
  const manipulatedUri = normalizeRequiredText(manipulated.uri, 'manipulatedUri');
  const outputFile = new File(manipulatedUri);
  const outputInfo = outputFile.info();
  const outputFileSize = typeof outputInfo.size === 'number' ? outputInfo.size : 0;
  if (!outputInfo.exists || outputFileSize <= 0) {
    throw new Error('Debug probe output is invalid.');
  }

  const outputWidth = Number(manipulated.width);
  const outputHeight = Number(manipulated.height);
  if (!Number.isFinite(outputWidth) || !Number.isFinite(outputHeight) || outputWidth <= 0 || outputHeight <= 0) {
    throw new Error('Debug probe output dimensions are invalid.');
  }

  const result: CropDebugProbeResult = {
    uri: manipulatedUri,
    width: Math.round(outputWidth),
    height: Math.round(outputHeight),
    fileSize: outputFileSize,
    sourceSizeUsed,
    sourceSizeMeasured,
    normalizedCropRect,
  };

  Logger.info(SERVICE_SCOPE, 'Crop debug probe succeeded.', {
    debugSessionId: params.debugSessionId ?? null,
    sourceUriShort: toShortUri(sourceUri),
    outputUriShort: toShortUri(result.uri),
    outputWidth: result.width,
    outputHeight: result.height,
    outputFileSize: result.fileSize,
    normalizedCropRect: result.normalizedCropRect,
  });

  return result;
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

    const measuredSourceSize = await getImageDimensions(sourceUri);
    const sourceSizeHint = normalizeImageSizeHint(params.sourceSizeHint);
    const originalSize = sourceSizeHint ?? measuredSourceSize;

    if (
      sourceSizeHint
      && (
        sourceSizeHint.width !== measuredSourceSize.width
        || sourceSizeHint.height !== measuredSourceSize.height
      )
    ) {
      Logger.warn(SERVICE_SCOPE, 'Source size hint differs from Image.getSize.', {
        debugSessionId: params.debugSessionId ?? null,
        sourceUriShort: toShortUri(sourceUri),
        sourceSizeHint,
        sourceSizeMeasured: measuredSourceSize,
      });
    }

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
      debugSessionId: params.debugSessionId ?? null,
      mistakeId,
      imageSlot,
      sourceUriShort: toShortUri(sourceUri),
      sourceWidth: originalSize.width,
      sourceHeight: originalSize.height,
      sourceSizeHint: sourceSizeHint ?? null,
      sourceSizeMeasured: measuredSourceSize,
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
      debugSessionId: params.debugSessionId ?? null,
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
      debugSessionId: params.debugSessionId ?? null,
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
