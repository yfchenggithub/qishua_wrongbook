import { Directory, File, Paths } from 'expo-file-system';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { Image } from 'react-native';

import { Logger } from '@/src/services/Logger';
import {
  CLEAR_PRINT_ENHANCE_CONFIG,
  PRINT_ENHANCE_TEMP_DIR_PARTS,
  toActivePrintEnhanceMode,
  type PrintEnhanceMode,
} from '@/src/utils/image/printEnhanceConfig';

const SERVICE_SCOPE = 'PrintImageEnhancer';
const MAX_TEMP_NAME_ATTEMPTS = 32;

export type PrintEnhanceResult = {
  success: boolean;
  outputUri: string;
  usedFallback: boolean;
  durationMs: number;
};

type ImageSize = {
  width: number;
  height: number;
};

function normalizeRequiredUri(value: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error('Image URI cannot be empty.');
  }
  return normalized;
}

function toShortUri(uri: string | null | undefined): string | null {
  if (!uri) {
    return null;
  }
  const normalized = uri.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= 80) {
    return normalized;
  }
  return `${normalized.slice(0, 36)}...${normalized.slice(-24)}`;
}

function getImageSize(uri: string): Promise<ImageSize> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => reject(new Error('Failed to read image size.')),
    );
  });
}

function normalizeImageSize(size: ImageSize): ImageSize | null {
  const width = Number(size.width);
  const height = Number(size.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  if (width <= 0 || height <= 0) {
    return null;
  }
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

function buildResizeByLongEdge(
  width: number,
  height: number,
  maxLongEdgePx: number,
): { width: number; height: number } | null {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdgePx) {
    return null;
  }
  const scale = maxLongEdgePx / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function safeReadFileSize(uri: string): number | null {
  try {
    const info = new File(uri).info();
    return typeof info.size === 'number' ? info.size : null;
  } catch {
    return null;
  }
}

function ensureTempDirectory(): Directory {
  const tempDirectory = new Directory(Paths.cache, ...PRINT_ENHANCE_TEMP_DIR_PARTS);
  tempDirectory.create({ intermediates: true, idempotent: true });
  return tempDirectory;
}

function createUniqueTempFile(tempDirectory: Directory): File {
  const timestamp = Date.now();
  for (let index = 0; index < MAX_TEMP_NAME_ATTEMPTS; index += 1) {
    const candidateName = `print_${timestamp}_${index}.jpg`;
    const candidate = new File(tempDirectory, candidateName);
    if (!candidate.exists) {
      return candidate;
    }
  }
  return new File(
    tempDirectory,
    `print_${timestamp}_${Math.floor(Math.random() * 100_000)}.jpg`,
  );
}

function safeDeleteFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to cleanup temporary print image file.', {
      uriPreview: toShortUri(uri),
      error,
    });
  }
}

export async function enhanceImageForPdfPrint(
  sourceUriInput: string,
  modeInput?: PrintEnhanceMode,
): Promise<PrintEnhanceResult> {
  const startedAt = Date.now();
  const sourceUri = normalizeRequiredUri(sourceUriInput);
  const mode = toActivePrintEnhanceMode(modeInput);

  if (mode === 'original') {
    return {
      success: true,
      outputUri: sourceUri,
      usedFallback: false,
      durationMs: Date.now() - startedAt,
    };
  }

  let originalSize: ImageSize | null = null;
  let outputSize: ImageSize | null = null;
  const originalFileSize = safeReadFileSize(sourceUri);
  let outputFileSize: number | null = null;
  let manipulatedUriToCleanup: string | null = null;

  try {
    try {
      originalSize = normalizeImageSize(await getImageSize(sourceUri));
    } catch {
      originalSize = null;
    }

    const resize = originalSize
      ? buildResizeByLongEdge(
        originalSize.width,
        originalSize.height,
        CLEAR_PRINT_ENHANCE_CONFIG.maxLongEdgePx,
      )
      : null;

    Logger.info(SERVICE_SCOPE, 'print_image_enhance_start', {
      mode,
      sourceUriPreview: toShortUri(sourceUri),
      originalWidth: originalSize?.width ?? null,
      originalHeight: originalSize?.height ?? null,
      originalFileSize,
      resizeTarget: resize,
      outputFormat: 'jpeg',
      quality: CLEAR_PRINT_ENHANCE_CONFIG.jpegQuality,
    });

    const manipulated = await manipulateAsync(sourceUri, resize ? [{ resize }] : [], {
      compress: CLEAR_PRINT_ENHANCE_CONFIG.jpegQuality,
      format: SaveFormat.JPEG,
      base64: false,
    });

    const manipulatedUri = normalizeRequiredUri(manipulated.uri);
    manipulatedUriToCleanup = manipulatedUri !== sourceUri ? manipulatedUri : null;

    outputSize = normalizeImageSize({
      width: manipulated.width,
      height: manipulated.height,
    });

    const tempDirectory = ensureTempDirectory();
    const tempOutputFile = createUniqueTempFile(tempDirectory);
    if (tempOutputFile.exists) {
      tempOutputFile.delete();
    }

    new File(manipulatedUri).copy(tempOutputFile);
    outputFileSize = safeReadFileSize(tempOutputFile.uri);

    const durationMs = Date.now() - startedAt;
    Logger.info(SERVICE_SCOPE, 'print_image_enhance_success', {
      mode,
      sourceUriPreview: toShortUri(sourceUri),
      outputUriPreview: toShortUri(tempOutputFile.uri),
      originalWidth: originalSize?.width ?? null,
      originalHeight: originalSize?.height ?? null,
      outputWidth: outputSize?.width ?? null,
      outputHeight: outputSize?.height ?? null,
      originalFileSize,
      outputFileSize,
      fileSizeDelta: (
        typeof originalFileSize === 'number' && typeof outputFileSize === 'number'
          ? outputFileSize - originalFileSize
          : null
      ),
      durationMs,
    });

    return {
      success: true,
      outputUri: tempOutputFile.uri,
      usedFallback: false,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    Logger.warn(SERVICE_SCOPE, 'print_image_enhance_failed_fallback_original', {
      mode,
      sourceUriPreview: toShortUri(sourceUri),
      originalWidth: originalSize?.width ?? null,
      originalHeight: originalSize?.height ?? null,
      outputWidth: outputSize?.width ?? null,
      outputHeight: outputSize?.height ?? null,
      originalFileSize,
      outputFileSize,
      durationMs,
      error,
    });

    return {
      success: false,
      outputUri: sourceUri,
      usedFallback: true,
      durationMs,
    };
  } finally {
    if (manipulatedUriToCleanup && manipulatedUriToCleanup !== sourceUri) {
      safeDeleteFile(manipulatedUriToCleanup);
    }
  }
}

export function cleanupPrintEnhancedTempFiles(tempUris: string[]): void {
  for (const uri of tempUris) {
    const normalized = typeof uri === 'string' ? uri.trim() : '';
    if (!normalized) {
      continue;
    }
    safeDeleteFile(normalized);
  }
}
