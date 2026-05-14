import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { Image } from 'react-native';

import { Logger } from '@/src/services/Logger';
import { ImageEnhancementError, type ScanEnhanceResult } from '@/src/services/imageEnhancement/types';

const SERVICE_SCOPE = 'ImageEnhancementService';
const ENHANCED_MAX_WIDTH = 2200;
const ENHANCED_MAX_HEIGHT = 3200;
const ENHANCED_QUALITY = 0.92;

function normalizeUri(inputUri: string): string {
  const normalized = typeof inputUri === 'string' ? inputUri.trim() : '';
  if (!normalized) {
    throw new ImageEnhancementError('INVALID_INPUT', '图片地址不能为空。');
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
  if (normalized.length <= 64) {
    return normalized;
  }
  return `${normalized.slice(0, 28)}...${normalized.slice(-20)}`;
}

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => reject(new ImageEnhancementError('READ_IMAGE_FAILED', '读取图片失败。')),
    );
  });
}

function computeResize(
  width: number,
  height: number,
): { width: number; height: number } | null {
  if (width <= ENHANCED_MAX_WIDTH && height <= ENHANCED_MAX_HEIGHT) {
    return null;
  }

  const scale = Math.min(ENHANCED_MAX_WIDTH / width, ENHANCED_MAX_HEIGHT / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function scanEnhanceImage(inputUri: string): Promise<ScanEnhanceResult> {
  const normalizedInputUri = normalizeUri(inputUri);
  Logger.info(SERVICE_SCOPE, 'Start scan enhance image.', {
    inputUriShort: toShortUri(normalizedInputUri),
  });

  try {
    const originalSize = await getImageSize(normalizedInputUri);
    const resize = computeResize(originalSize.width, originalSize.height);

    // TODO: Add real scan enhancement pipeline (auto-crop, contrast normalization, shadow removal).
    const enhanced = await manipulateAsync(
      normalizedInputUri,
      resize ? [{ resize }] : [],
      {
        compress: ENHANCED_QUALITY,
        format: SaveFormat.JPEG,
        base64: false,
      },
    );

    const enhancedUri = typeof enhanced.uri === 'string' ? enhanced.uri.trim() : '';
    if (!enhancedUri) {
      throw new ImageEnhancementError('INVALID_OUTPUT', '增强结果无效。');
    }

    Logger.info(SERVICE_SCOPE, 'Scan enhance image finished.', {
      inputUriShort: toShortUri(normalizedInputUri),
      enhancedUriShort: toShortUri(enhancedUri),
      width: enhanced.width,
      height: enhanced.height,
      resized: Boolean(resize),
    });

    return {
      enhancedUri,
      width: enhanced.width,
      height: enhanced.height,
    };
  } catch (error) {
    if (error instanceof ImageEnhancementError) {
      Logger.warn(SERVICE_SCOPE, 'Scan enhance image aborted with controllable error.', {
        inputUriShort: toShortUri(normalizedInputUri),
        code: error.code,
        message: error.message,
      });
      throw error;
    }

    Logger.error(SERVICE_SCOPE, 'Scan enhance image failed unexpectedly.', {
      inputUriShort: toShortUri(normalizedInputUri),
      error,
    });
    throw new ImageEnhancementError('ENHANCE_FAILED', '图片增强失败。');
  }
}
