import type { LocalImage } from '@/src/models/LocalImage';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'AddDraftImageEditService';

export type AddDraftImageEditResult = {
  editId: string;
  draftId: string;
  sourceImageId: string;
  image: LocalImage;
};

type SaveAddDraftImageEditResultParams = {
  editId: string;
  draftId: string;
  sourceImageId: string;
  image: LocalImage;
};

const editResults = new Map<string, AddDraftImageEditResult>();

function normalizeRequiredText(value: string | null | undefined, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`${fieldName} 不能为空。`);
  }
  return normalized;
}

export function saveAddDraftImageEditResult(
  params: SaveAddDraftImageEditResultParams,
): AddDraftImageEditResult {
  const editId = normalizeRequiredText(params.editId, 'editId');
  const draftId = normalizeRequiredText(params.draftId, 'draftId');
  const sourceImageId = normalizeRequiredText(params.sourceImageId, 'sourceImageId');
  const imageUri = normalizeRequiredText(params.image?.uri, 'image.uri');

  const result: AddDraftImageEditResult = {
    editId,
    draftId,
    sourceImageId,
    image: {
      ...params.image,
      mistakeId: draftId,
      type: 'question',
      uri: imageUri,
    },
  };

  editResults.set(editId, result);
  Logger.info(SERVICE_SCOPE, 'Saved add-draft image edit result.', {
    editId,
    draftId,
    sourceImageId,
  });
  return result;
}

export function consumeAddDraftImageEditResult(
  editId: string | null | undefined,
): AddDraftImageEditResult | null {
  const normalizedEditId = typeof editId === 'string' ? editId.trim() : '';
  if (!normalizedEditId) {
    return null;
  }

  const result = editResults.get(normalizedEditId) ?? null;
  if (result) {
    editResults.delete(normalizedEditId);
    Logger.info(SERVICE_SCOPE, 'Consumed add-draft image edit result.', {
      editId: normalizedEditId,
      draftId: result.draftId,
      sourceImageId: result.sourceImageId,
    });
  }
  return result;
}
