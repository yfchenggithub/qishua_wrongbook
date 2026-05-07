import {
  IMAGE_FILE_EXTENSION,
  IMAGE_FILE_PREFIX,
  IMAGE_ROOT_DIR_NAME,
  MISTAKE_IMAGE_DIR_NAME,
} from '@/src/constants/image';
import type { LocalImageType } from '@/src/models/LocalImage';

const VALID_IMAGE_TYPES: LocalImageType[] = [
  'question',
  'my_solution',
  'answer',
  'review_solution',
];

function sanitizePathSegment(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
}

function toPositiveInt(value: number): number {
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    throw new Error('Image index must be a positive integer.');
  }
  return normalized;
}

export function normalizeImageType(type: string): LocalImageType {
  const normalized = type.trim().toLowerCase().replace(/[\s-]+/g, '_');

  if (normalized === 'review') {
    return 'review_solution';
  }

  if (VALID_IMAGE_TYPES.includes(normalized as LocalImageType)) {
    return normalized as LocalImageType;
  }

  throw new Error(`Unsupported image type: ${type}`);
}

export function buildMistakeImageDir(mistakeId: string): string {
  const safeMistakeId = sanitizePathSegment(mistakeId);
  if (!safeMistakeId) {
    throw new Error('mistakeId is required to build image directory.');
  }

  return `${IMAGE_ROOT_DIR_NAME}/${MISTAKE_IMAGE_DIR_NAME}/${safeMistakeId}`;
}

export function buildImageFileName(type: LocalImageType, index = 1): string {
  const normalizedType = normalizeImageType(type);
  const safeIndex = toPositiveInt(index);
  const paddedIndex = safeIndex.toString().padStart(3, '0');

  return `${IMAGE_FILE_PREFIX[normalizedType]}_${paddedIndex}.${IMAGE_FILE_EXTENSION}`;
}

export function buildImageRelativePath(
  mistakeId: string,
  type: LocalImageType,
  fileName: string,
): string {
  const normalizedType = normalizeImageType(type);
  const safeFileName = sanitizePathSegment(fileName);

  if (!safeFileName) {
    throw new Error('fileName is required to build image relative path.');
  }

  const expectedPrefix = `${IMAGE_FILE_PREFIX[normalizedType]}_`;
  if (!safeFileName.startsWith(expectedPrefix)) {
    throw new Error(
      `fileName must start with "${expectedPrefix}" for type "${normalizedType}".`,
    );
  }

  return `${buildMistakeImageDir(mistakeId)}/${safeFileName}`;
}

export function createImageId(): string {
  const randomPart = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');

  return `IMG${Date.now()}${randomPart}`;
}
