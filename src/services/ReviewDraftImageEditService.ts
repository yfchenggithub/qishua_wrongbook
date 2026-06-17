import type { LocalImage } from '@/src/models/LocalImage';
import { createImageId } from '@/src/services/ImagePathService';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'ReviewDraftImageEditService';

export type ReviewDraftImageEditResult = {
  editId: string;
  mistakeId: string;
  image: LocalImage;
};

type SaveReviewDraftImageEditResultParams = {
  editId: string;
  mistakeId: string;
  imageUri: string;
  width?: number;
  height?: number;
  fileSize?: number | null;
};

const reviewDraftImageEditResults = new Map<string, ReviewDraftImageEditResult>();

function normalizeRequiredText(value: string | null | undefined, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`${fieldName} 不能为空。`);
  }
  return normalized;
}

function getFileNameFromUri(uri: string): string {
  const normalizedUri = uri.trim();
  const queryIndex = normalizedUri.indexOf('?');
  const pathOnly = queryIndex >= 0 ? normalizedUri.slice(0, queryIndex) : normalizedUri;
  const lastSlashIndex = Math.max(pathOnly.lastIndexOf('/'), pathOnly.lastIndexOf('\\'));
  const fileName = lastSlashIndex >= 0 ? pathOnly.slice(lastSlashIndex + 1) : pathOnly;
  return fileName || 'review_solution.jpg';
}

function getDirectoryFromUri(uri: string): string {
  const normalizedUri = uri.trim();
  const queryIndex = normalizedUri.indexOf('?');
  const pathOnly = queryIndex >= 0 ? normalizedUri.slice(0, queryIndex) : normalizedUri;
  const lastSlashIndex = Math.max(pathOnly.lastIndexOf('/'), pathOnly.lastIndexOf('\\'));
  if (lastSlashIndex <= 0) {
    return '';
  }
  return pathOnly.slice(0, lastSlashIndex);
}

export function saveReviewDraftImageEditResult(
  params: SaveReviewDraftImageEditResultParams,
): ReviewDraftImageEditResult {
  const editId = normalizeRequiredText(params.editId, 'editId');
  const mistakeId = normalizeRequiredText(params.mistakeId, 'mistakeId');
  const imageUri = normalizeRequiredText(params.imageUri, 'imageUri');

  const result: ReviewDraftImageEditResult = {
    editId,
    mistakeId,
    image: {
      id: createImageId(),
      mistakeId,
      type: 'review_solution',
      uri: imageUri,
      fileName: getFileNameFromUri(imageUri),
      directory: getDirectoryFromUri(imageUri),
      createdAt: new Date().toISOString(),
      width: params.width,
      height: params.height,
      fileSize: params.fileSize ?? null,
    },
  };

  reviewDraftImageEditResults.set(editId, result);
  Logger.info(SERVICE_SCOPE, 'Saved review draft image edit result.', {
    editId,
    mistakeId,
    imageUriLength: imageUri.length,
  });

  return result;
}

export function consumeReviewDraftImageEditResult(editId: string | null | undefined): ReviewDraftImageEditResult | null {
  const normalizedEditId = typeof editId === 'string' ? editId.trim() : '';
  if (!normalizedEditId) {
    return null;
  }

  const result = reviewDraftImageEditResults.get(normalizedEditId) ?? null;
  if (result) {
    reviewDraftImageEditResults.delete(normalizedEditId);
    Logger.info(SERVICE_SCOPE, 'Consumed review draft image edit result.', {
      editId: normalizedEditId,
      mistakeId: result.mistakeId,
    });
  }

  return result;
}
