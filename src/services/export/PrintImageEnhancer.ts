import { Directory, File, Paths } from 'expo-file-system';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { Image, NativeModules, Platform } from 'react-native';

import { Logger } from '@/src/services/Logger';
import {
  CLEAR_PRINT_ENHANCE_CONFIG,
  PRINT_ENHANCE_TEMP_DIR_PARTS,
  toActivePrintEnhanceMode,
  type PrintEnhanceMode,
} from '@/src/utils/image/printEnhanceConfig';

const SERVICE_SCOPE = 'PrintImageEnhancer';
const MAX_TEMP_NAME_ATTEMPTS = 32;
const OPENCV_NATIVE_MODULE_CANDIDATES = [
  'QishuaPrintImageEnhanceModule',
  'QishuaImageEnhanceModule',
] as const;

export type PrintEnhanceEngine =
  | 'original'
  | 'opencv'
  | 'bitmap_fallback'
  | 'original_fallback';

export type PrintEnhanceResult = {
  success: boolean;
  outputUri: string;
  engine: PrintEnhanceEngine;
  usedFallback: boolean;
  durationMs: number;
};

type ImageSize = {
  width: number;
  height: number;
};

type ProviderName = 'opencv' | 'bitmap_fallback';

type ProviderSuccessResult = {
  success: true;
  provider: ProviderName;
  outputUri: string;
  outputSize: ImageSize | null;
  outputFileSize: number | null;
  durationMs: number;
};

type ProviderFailedResult = {
  success: false;
  provider: ProviderName;
  reason: 'unsupported' | 'failed';
  error?: unknown;
  durationMs: number;
};

type ProviderResult = ProviderSuccessResult | ProviderFailedResult;

type OpenCvNativeEnhanceResponse = {
  success?: boolean;
  outputUri?: string;
  error?: string;
};

type OpenCvNativeEnhanceRequest = {
  sourceUri: string;
  outputUri: string;
  mode: Exclude<PrintEnhanceMode, 'original'>;
  maxLongEdgePx: number;
  jpegQuality: number;
};

type OpenCvNativeEnhanceModule = {
  enhanceForPdfPrint: (request: OpenCvNativeEnhanceRequest) => Promise<OpenCvNativeEnhanceResponse | void>;
};

function normalizeRequiredUri(value: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error('Image URI cannot be empty.');
  }
  return normalized;
}

function normalizeOptionalUri(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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

function resolveOpenCvNativeModule(): OpenCvNativeEnhanceModule | null {
  for (const moduleName of OPENCV_NATIVE_MODULE_CANDIDATES) {
    const candidate = (NativeModules as Record<string, unknown>)[moduleName] as
      | Partial<OpenCvNativeEnhanceModule>
      | undefined;
    if (candidate && typeof candidate.enhanceForPdfPrint === 'function') {
      return candidate as OpenCvNativeEnhanceModule;
    }
  }
  return null;
}

async function runOpenCvEnhanceProvider(
  sourceUri: string,
  mode: Exclude<PrintEnhanceMode, 'original'>,
): Promise<ProviderResult> {
  const startedAt = Date.now();

  if (Platform.OS !== 'android') {
    return {
      success: false,
      provider: 'opencv',
      reason: 'unsupported',
      durationMs: Date.now() - startedAt,
    };
  }

  const nativeModule = resolveOpenCvNativeModule();
  if (!nativeModule) {
    return {
      success: false,
      provider: 'opencv',
      reason: 'unsupported',
      durationMs: Date.now() - startedAt,
    };
  }

  const tempDirectory = ensureTempDirectory();
  const tempOutputFile = createUniqueTempFile(tempDirectory);
  if (tempOutputFile.exists) {
    tempOutputFile.delete();
  }

  try {
    const response = await nativeModule.enhanceForPdfPrint({
      sourceUri,
      outputUri: tempOutputFile.uri,
      mode,
      maxLongEdgePx: CLEAR_PRINT_ENHANCE_CONFIG.maxLongEdgePx,
      jpegQuality: CLEAR_PRINT_ENHANCE_CONFIG.jpegQuality,
    });

    const hasExplicitFailure =
      typeof response === 'object'
      && response !== null
      && response.success === false;
    if (hasExplicitFailure) {
      const errorMessage =
        typeof response?.error === 'string' && response.error.trim().length > 0
          ? response.error.trim()
          : 'OpenCV native provider returned unsuccessful result.';
      throw new Error(errorMessage);
    }

    const responseOutputUri = normalizeOptionalUri(response?.outputUri);
    const candidateOutputUris = responseOutputUri
      ? [responseOutputUri, tempOutputFile.uri]
      : [tempOutputFile.uri];
    const resolvedOutputUri = candidateOutputUris.find((candidateUri) => {
      try {
        return new File(candidateUri).exists;
      } catch {
        return false;
      }
    });
    if (!resolvedOutputUri) {
      throw new Error('OpenCV provider output file is missing.');
    }

    let outputSize: ImageSize | null = null;
    try {
      outputSize = normalizeImageSize(await getImageSize(resolvedOutputUri));
    } catch {
      outputSize = null;
    }

    return {
      success: true,
      provider: 'opencv',
      outputUri: resolvedOutputUri,
      outputSize,
      outputFileSize: safeReadFileSize(resolvedOutputUri),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    safeDeleteFile(tempOutputFile.uri);
    return {
      success: false,
      provider: 'opencv',
      reason: 'failed',
      error,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function runBitmapFallbackEnhanceProvider(
  sourceUri: string,
): Promise<ProviderResult> {
  const startedAt = Date.now();
  let manipulatedUriToCleanup: string | null = null;

  try {
    let originalSize: ImageSize | null = null;
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

    const manipulated = await manipulateAsync(sourceUri, resize ? [{ resize }] : [], {
      compress: CLEAR_PRINT_ENHANCE_CONFIG.jpegQuality,
      format: SaveFormat.JPEG,
      base64: false,
    });
    const manipulatedUri = normalizeRequiredUri(manipulated.uri);
    manipulatedUriToCleanup = manipulatedUri !== sourceUri ? manipulatedUri : null;

    const outputSize = normalizeImageSize({
      width: manipulated.width,
      height: manipulated.height,
    });

    const tempDirectory = ensureTempDirectory();
    const tempOutputFile = createUniqueTempFile(tempDirectory);
    if (tempOutputFile.exists) {
      tempOutputFile.delete();
    }
    new File(manipulatedUri).copy(tempOutputFile);

    return {
      success: true,
      provider: 'bitmap_fallback',
      outputUri: tempOutputFile.uri,
      outputSize,
      outputFileSize: safeReadFileSize(tempOutputFile.uri),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      success: false,
      provider: 'bitmap_fallback',
      reason: 'failed',
      error,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    if (manipulatedUriToCleanup && manipulatedUriToCleanup !== sourceUri) {
      safeDeleteFile(manipulatedUriToCleanup);
    }
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
      engine: 'original',
      usedFallback: false,
      durationMs: Date.now() - startedAt,
    };
  }

  let originalSize: ImageSize | null = null;
  const originalFileSize = safeReadFileSize(sourceUri);
  const providerAttempts: Array<{
    provider: ProviderName;
    reason: 'unsupported' | 'failed';
    durationMs: number;
    error?: string;
  }> = [];

  try {
    try {
      originalSize = normalizeImageSize(await getImageSize(sourceUri));
    } catch {
      originalSize = null;
    }

    Logger.info(SERVICE_SCOPE, 'print_image_enhance_start', {
      mode,
      sourceUriPreview: toShortUri(sourceUri),
      originalWidth: originalSize?.width ?? null,
      originalHeight: originalSize?.height ?? null,
      originalFileSize,
    });

    const openCvResult = await runOpenCvEnhanceProvider(sourceUri, mode);
    if (openCvResult.success) {
      const durationMs = Date.now() - startedAt;
      Logger.info(SERVICE_SCOPE, 'print_image_enhance_success', {
        mode,
        engine: 'opencv',
        sourceUriPreview: toShortUri(sourceUri),
        outputUriPreview: toShortUri(openCvResult.outputUri),
        originalWidth: originalSize?.width ?? null,
        originalHeight: originalSize?.height ?? null,
        outputWidth: openCvResult.outputSize?.width ?? null,
        outputHeight: openCvResult.outputSize?.height ?? null,
        originalFileSize,
        outputFileSize: openCvResult.outputFileSize,
        fileSizeDelta: (
          typeof originalFileSize === 'number' && typeof openCvResult.outputFileSize === 'number'
            ? openCvResult.outputFileSize - originalFileSize
            : null
        ),
        providerDurationMs: openCvResult.durationMs,
        durationMs,
      });
      return {
        success: true,
        outputUri: openCvResult.outputUri,
        engine: 'opencv',
        usedFallback: false,
        durationMs,
      };
    }
    providerAttempts.push({
      provider: openCvResult.provider,
      reason: openCvResult.reason,
      durationMs: openCvResult.durationMs,
      error:
        openCvResult.error instanceof Error
          ? openCvResult.error.message
          : openCvResult.error
            ? String(openCvResult.error)
            : undefined,
    });

    const bitmapFallbackResult = await runBitmapFallbackEnhanceProvider(sourceUri);
    if (bitmapFallbackResult.success) {
      const durationMs = Date.now() - startedAt;
      Logger.info(SERVICE_SCOPE, 'print_image_enhance_success', {
        mode,
        engine: 'bitmap_fallback',
        sourceUriPreview: toShortUri(sourceUri),
        outputUriPreview: toShortUri(bitmapFallbackResult.outputUri),
        originalWidth: originalSize?.width ?? null,
        originalHeight: originalSize?.height ?? null,
        outputWidth: bitmapFallbackResult.outputSize?.width ?? null,
        outputHeight: bitmapFallbackResult.outputSize?.height ?? null,
        originalFileSize,
        outputFileSize: bitmapFallbackResult.outputFileSize,
        fileSizeDelta: (
          typeof originalFileSize === 'number' && typeof bitmapFallbackResult.outputFileSize === 'number'
            ? bitmapFallbackResult.outputFileSize - originalFileSize
            : null
        ),
        providerDurationMs: bitmapFallbackResult.durationMs,
        durationMs,
      });
      return {
        success: true,
        outputUri: bitmapFallbackResult.outputUri,
        engine: 'bitmap_fallback',
        usedFallback: true,
        durationMs,
      };
    }
    providerAttempts.push({
      provider: bitmapFallbackResult.provider,
      reason: bitmapFallbackResult.reason,
      durationMs: bitmapFallbackResult.durationMs,
      error:
        bitmapFallbackResult.error instanceof Error
          ? bitmapFallbackResult.error.message
          : bitmapFallbackResult.error
            ? String(bitmapFallbackResult.error)
            : undefined,
    });

    const durationMs = Date.now() - startedAt;
    Logger.warn(SERVICE_SCOPE, 'print_image_enhance_failed_fallback_original', {
      mode,
      sourceUriPreview: toShortUri(sourceUri),
      originalWidth: originalSize?.width ?? null,
      originalHeight: originalSize?.height ?? null,
      originalFileSize,
      providerAttempts,
      durationMs,
    });

    return {
      success: false,
      outputUri: sourceUri,
      engine: 'original_fallback',
      usedFallback: true,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    Logger.warn(SERVICE_SCOPE, 'print_image_enhance_failed_fallback_original', {
      mode,
      sourceUriPreview: toShortUri(sourceUri),
      originalWidth: originalSize?.width ?? null,
      originalHeight: originalSize?.height ?? null,
      originalFileSize,
      providerAttempts,
      durationMs,
      error,
    });

    return {
      success: false,
      outputUri: sourceUri,
      engine: 'original_fallback',
      usedFallback: true,
      durationMs,
    };
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
