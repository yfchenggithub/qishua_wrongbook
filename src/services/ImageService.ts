import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';

import type { LocalImage, LocalImageType, SavedImageResult } from '@/src/models/LocalImage';
import { optimizeImageForStorage } from '@/src/services/ImageOptimizeService';
import {
  pickImageFromLibrary,
  pickImagesFromLibrary,
  requestCameraPermission,
  requestMediaLibraryPermission,
  takePhoto,
} from '@/src/services/ImagePickerService';
import type { PermissionRequestResult } from '@/src/services/ImagePickerService';
import {
  deleteLocalImage as deleteLocalImageFile,
  deleteMistakeImageFolder,
  getImageInfo,
  listMistakeImageFiles,
  saveTempImageToMistakeFolder,
} from '@/src/services/ImageStorageService';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'ImageService';
const IMAGE_SHARE_DIALOG_TITLE = '分享图片';
const IMAGE_SAVE_PARENT_FOLDER = 'qishua_wrongbook';
const INVALID_IMAGE_URI_MESSAGE = '图片路径无效，请返回详情页重试。';
const MISSING_IMAGE_FILE_MESSAGE = '图片文件不存在，可能已被删除或未恢复。';
const SHARE_UNAVAILABLE_MESSAGE = '当前设备暂不支持分享图片。';
const SAVE_UNAVAILABLE_MESSAGE = '当前设备暂不支持保存图片。';
const FALLBACK_IMAGE_SHARE_MESSAGE = '分享图片失败，请稍后重试。';
const FALLBACK_IMAGE_SAVE_MESSAGE = '保存图片失败，请稍后重试。';

export interface SaveImageParams {
  mistakeId: string;
  type: LocalImageType;
  index?: number;
}

export interface SaveImagesParams {
  mistakeId: string;
  type: LocalImageType;
  index?: number;
  maxSelection?: number;
}

export type ImagePermissionResult = PermissionRequestResult;

export interface SavedImagesResult {
  ok: boolean;
  images: LocalImage[];
  errorMessage?: string;
}

export type ShareLocalImageResult =
  | { success: true }
  | {
    success: false;
    reason: 'invalid_uri' | 'file_missing' | 'share_unavailable' | 'cancelled' | 'unknown';
    message: string;
  };

export type SaveLocalImageToGalleryResult =
  | {
    success: true;
    savedUri: string;
  }
  | {
    success: false;
    reason: 'invalid_uri' | 'file_missing' | 'save_unavailable' | 'unknown';
    message: string;
  };

interface PreparedImagePayload {
  uri: string;
  width?: number;
  height?: number;
  fileSize?: number | null;
}

function toShortUri(uri: string | null | undefined): string | null {
  if (typeof uri !== 'string') {
    return null;
  }

  const trimmed = uri.trim();
  if (trimmed.length <= 64) {
    return trimmed;
  }
  return `${trimmed.slice(0, 28)}...${trimmed.slice(-20)}`;
}

function normalizeImageUri(uri: string | null | undefined): string | null {
  if (typeof uri !== 'string') {
    return null;
  }

  const trimmed = uri.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toAndroidFilePath(uri: string): string {
  if (uri.startsWith('file://')) {
    return uri.slice('file://'.length);
  }
  return uri;
}

function isUserCancelledShare(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  return (
    message.includes('cancel')
    || message.includes('canceled')
    || message.includes('cancelled')
    || message.includes('dismiss')
    || message.includes('did not share')
    || name.includes('abort')
  );
}

function stripUriQuery(uri: string): string {
  const queryIndex = uri.indexOf('?');
  if (queryIndex >= 0) {
    return uri.slice(0, queryIndex);
  }
  return uri;
}

function getImageFileName(uri: string): string {
  const cleanUri = stripUriQuery(uri);
  const lastSlashIndex = cleanUri.lastIndexOf('/');
  const candidate = lastSlashIndex >= 0 ? cleanUri.slice(lastSlashIndex + 1) : cleanUri;
  const trimmed = candidate.trim();
  if (trimmed) {
    return trimmed;
  }
  return `qishua_wrongbook_image_${Date.now()}.jpg`;
}

function guessImageMimeType(uri: string): string {
  const lowerUri = stripUriQuery(uri).toLowerCase();
  if (lowerUri.endsWith('.png')) {
    return 'image/png';
  }
  if (lowerUri.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lowerUri.endsWith('.gif')) {
    return 'image/gif';
  }
  if (lowerUri.endsWith('.bmp')) {
    return 'image/bmp';
  }
  if (lowerUri.endsWith('.heic')) {
    return 'image/heic';
  }
  if (lowerUri.endsWith('.heif')) {
    return 'image/heif';
  }
  return 'image/jpeg';
}

function imageFileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to check local image file existence.', {
      uriShort: toShortUri(uri),
      error,
    });
    return false;
  }
}

function canceledResult(errorMessage: string): SavedImageResult {
  return {
    ok: false,
    errorMessage,
  };
}

function canceledBatchResult(errorMessage: string): SavedImagesResult {
  return {
    ok: false,
    images: [],
    errorMessage,
  };
}

async function prepareImageForStorage(
  tempUri: string,
  fallback: Omit<PreparedImagePayload, 'uri'>,
): Promise<PreparedImagePayload> {
  const optimized = await optimizeImageForStorage({ uri: tempUri });
  if (!optimized.ok || !optimized.uri) {
    Logger.error(
      SERVICE_SCOPE,
      'Image optimization failed, fallback to original temp image.',
      { tempUri, optimized },
    );
    return {
      uri: tempUri,
      width: fallback.width,
      height: fallback.height,
      fileSize: fallback.fileSize,
    };
  }

  Logger.info(SERVICE_SCOPE, 'Image optimization succeeded.', {
    sourceUri: tempUri,
    optimizedUri: optimized.uri,
    optimizedWidth: optimized.width,
    optimizedHeight: optimized.height,
    optimizedFileSize: optimized.fileSize,
  });

  return {
    uri: optimized.uri,
    width: optimized.width,
    height: optimized.height,
    fileSize: optimized.fileSize ?? null,
  };
}

export async function takePhotoAndSave(
  params: SaveImageParams,
): Promise<SavedImageResult> {
  Logger.info(SERVICE_SCOPE, 'Start taking photo and saving image.', {
    mistakeId: params.mistakeId,
    type: params.type,
    index: params.index,
  });

  try {
    const picked = await takePhoto();
    if (picked.canceled) {
      Logger.warn(SERVICE_SCOPE, 'User canceled taking photo.', {
        mistakeId: params.mistakeId,
        type: params.type,
        index: params.index,
        reason: picked.errorMessage ?? null,
      });
      return canceledResult(picked.errorMessage ?? 'User canceled taking photo.');
    }

    if (!picked.tempUri) {
      Logger.error(SERVICE_SCOPE, 'Failed to take photo: tempUri is empty.', {
        params,
        picked,
      });
      return canceledResult('Invalid photo result. Please try again.');
    }

    Logger.info(SERVICE_SCOPE, 'Photo captured successfully.', {
      mistakeId: params.mistakeId,
      type: params.type,
      index: params.index,
      tempUriShort: toShortUri(picked.tempUri),
      width: picked.width,
      height: picked.height,
      fileSize: picked.fileSize ?? null,
    });

    const preparedImage = await prepareImageForStorage(picked.tempUri, {
      width: picked.width,
      height: picked.height,
      fileSize: picked.fileSize ?? null,
    });

    const savedResult = await saveTempImageToMistakeFolder({
      mistakeId: params.mistakeId,
      type: params.type,
      tempUri: preparedImage.uri,
      width: preparedImage.width,
      height: preparedImage.height,
      fileSize: preparedImage.fileSize ?? null,
      index: params.index,
    });

    if (!savedResult.ok) {
      Logger.error(SERVICE_SCOPE, 'Failed to save taken photo to local folder.', {
        params,
        savedResult,
      });
    } else {
      Logger.info(SERVICE_SCOPE, 'Saved taken photo to local folder successfully.', {
        mistakeId: params.mistakeId,
        type: params.type,
        index: params.index,
        savedUriShort: toShortUri(savedResult.image?.uri),
      });
    }

    return savedResult;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Unexpected error in takePhotoAndSave.', {
      params,
      error,
    });
    return canceledResult(error instanceof Error ? error.message : String(error));
  }
}

export async function checkCameraPermission(): Promise<ImagePermissionResult> {
  try {
    return await requestCameraPermission();
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Unexpected error in checkCameraPermission.', error);
    return {
      granted: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkMediaLibraryPermission(): Promise<ImagePermissionResult> {
  try {
    return await requestMediaLibraryPermission();
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Unexpected error in checkMediaLibraryPermission.', error);
    return {
      granted: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function pickImageAndSave(
  params: SaveImageParams,
): Promise<SavedImageResult> {
  Logger.info(SERVICE_SCOPE, 'Start picking image and saving.', {
    mistakeId: params.mistakeId,
    type: params.type,
    index: params.index,
  });

  try {
    const picked = await pickImageFromLibrary();
    if (picked.canceled) {
      Logger.warn(SERVICE_SCOPE, 'User canceled picking image from library.', {
        mistakeId: params.mistakeId,
        type: params.type,
        index: params.index,
        reason: picked.errorMessage ?? null,
      });
      return canceledResult(picked.errorMessage ?? 'User canceled image selection.');
    }

    if (!picked.tempUri) {
      Logger.error(SERVICE_SCOPE, 'Failed to pick image: tempUri is empty.', {
        params,
        picked,
      });
      return canceledResult('Invalid image result. Please try again.');
    }

    Logger.info(SERVICE_SCOPE, 'Picked image successfully.', {
      mistakeId: params.mistakeId,
      type: params.type,
      index: params.index,
      tempUriShort: toShortUri(picked.tempUri),
      width: picked.width,
      height: picked.height,
      fileSize: picked.fileSize ?? null,
    });

    const preparedImage = await prepareImageForStorage(picked.tempUri, {
      width: picked.width,
      height: picked.height,
      fileSize: picked.fileSize ?? null,
    });

    const savedResult = await saveTempImageToMistakeFolder({
      mistakeId: params.mistakeId,
      type: params.type,
      tempUri: preparedImage.uri,
      width: preparedImage.width,
      height: preparedImage.height,
      fileSize: preparedImage.fileSize ?? null,
      index: params.index,
    });

    if (!savedResult.ok) {
      Logger.error(SERVICE_SCOPE, 'Failed to save picked image to local folder.', {
        params,
        savedResult,
      });
    } else {
      Logger.info(SERVICE_SCOPE, 'Saved picked image to local folder successfully.', {
        mistakeId: params.mistakeId,
        type: params.type,
        index: params.index,
        savedUriShort: toShortUri(savedResult.image?.uri),
      });
    }

    return savedResult;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Unexpected error in pickImageAndSave.', {
      params,
      error,
    });
    return canceledResult(error instanceof Error ? error.message : String(error));
  }
}

export async function pickImagesAndSave(
  params: SaveImagesParams,
): Promise<SavedImagesResult> {
  Logger.info(SERVICE_SCOPE, 'Start picking images and saving.', {
    mistakeId: params.mistakeId,
    type: params.type,
    index: params.index,
    maxSelection: params.maxSelection,
  });

  try {
    const picked = await pickImagesFromLibrary(params.maxSelection);
    if (picked.canceled) {
      Logger.warn(SERVICE_SCOPE, 'User canceled picking images from library.', {
        mistakeId: params.mistakeId,
        type: params.type,
        index: params.index,
        maxSelection: params.maxSelection,
        reason: picked.errorMessage ?? null,
      });
      return canceledBatchResult(picked.errorMessage ?? 'User canceled image selection.');
    }

    const assets = Array.isArray(picked.assets) ? picked.assets : [];
    if (assets.length === 0) {
      Logger.warn(SERVICE_SCOPE, 'Picked image assets are empty.', {
        mistakeId: params.mistakeId,
        type: params.type,
      });
      return canceledBatchResult('Invalid image result. Please try again.');
    }

    Logger.info(SERVICE_SCOPE, 'Picked images successfully.', {
      mistakeId: params.mistakeId,
      type: params.type,
      pickedCount: assets.length,
    });

    const savedImages: LocalImage[] = [];
    const startIndex = typeof params.index === 'number' ? params.index : undefined;

    for (let i = 0; i < assets.length; i += 1) {
      const asset = assets[i];
      const preparedImage = await prepareImageForStorage(asset.tempUri, {
        width: asset.width,
        height: asset.height,
        fileSize: asset.fileSize ?? null,
      });

      const savedResult = await saveTempImageToMistakeFolder({
        mistakeId: params.mistakeId,
        type: params.type,
        tempUri: preparedImage.uri,
        width: preparedImage.width,
        height: preparedImage.height,
        fileSize: preparedImage.fileSize ?? null,
        index: startIndex === undefined ? undefined : startIndex + i,
      });

      if (!savedResult.ok || !savedResult.image) {
        Logger.error(SERVICE_SCOPE, 'Failed to save picked image in batch.', {
          params,
          savedCount: savedImages.length,
          failedIndex: i,
          savedResult,
        });
        return {
          ok: false,
          images: savedImages,
          errorMessage: savedResult.errorMessage ?? 'Failed to save image.',
        };
      }

      savedImages.push(savedResult.image);
      Logger.info(SERVICE_SCOPE, 'Saved one picked image in batch successfully.', {
        mistakeId: params.mistakeId,
        type: params.type,
        batchIndex: i,
        savedUriShort: toShortUri(savedResult.image.uri),
      });
    }

    Logger.info(SERVICE_SCOPE, 'Saved picked images batch successfully.', {
      mistakeId: params.mistakeId,
      type: params.type,
      savedCount: savedImages.length,
    });

    return {
      ok: true,
      images: savedImages,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Unexpected error in pickImagesAndSave.', {
      params,
      error,
    });
    return canceledBatchResult(error instanceof Error ? error.message : String(error));
  }
}

export async function getLocalImageInfo(
  uri: string,
): Promise<{ exists: boolean; size?: number | null }> {
  try {
    return await getImageInfo(uri);
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Unexpected error in getLocalImageInfo.', {
      uri,
      error,
    });
    return { exists: false, size: null };
  }
}

export async function listLocalImagesByMistakeId(mistakeId: string): Promise<string[]> {
  try {
    return await listMistakeImageFiles(mistakeId);
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Unexpected error in listLocalImagesByMistakeId.', {
      mistakeId,
      error,
    });
    return [];
  }
}

export async function deleteLocalImage(uri: string): Promise<boolean> {
  Logger.info(SERVICE_SCOPE, 'Start deleting local image.', {
    uriShort: toShortUri(uri),
  });

  try {
    const deleted = await deleteLocalImageFile(uri);
    if (deleted) {
      Logger.info(SERVICE_SCOPE, 'Deleted local image successfully.', {
        uriShort: toShortUri(uri),
      });
    } else {
      Logger.warn(SERVICE_SCOPE, 'Delete local image failed.', {
        uriShort: toShortUri(uri),
      });
    }
    return deleted;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Unexpected error in deleteLocalImage.', {
      uriShort: toShortUri(uri),
      error,
    });
    return false;
  }
}

export async function shareLocalImage(uri: string): Promise<ShareLocalImageResult> {
  const normalizedUri = normalizeImageUri(uri);
  if (!normalizedUri) {
    return {
      success: false,
      reason: 'invalid_uri',
      message: INVALID_IMAGE_URI_MESSAGE,
    };
  }

  if (!imageFileExists(normalizedUri)) {
    return {
      success: false,
      reason: 'file_missing',
      message: MISSING_IMAGE_FILE_MESSAGE,
    };
  }

  const isShareAvailable = await Sharing.isAvailableAsync();
  if (!isShareAvailable) {
    return {
      success: false,
      reason: 'share_unavailable',
      message: SHARE_UNAVAILABLE_MESSAGE,
    };
  }

  try {
    await Sharing.shareAsync(normalizedUri, {
      mimeType: guessImageMimeType(normalizedUri),
      dialogTitle: IMAGE_SHARE_DIALOG_TITLE,
    });
    Logger.info(SERVICE_SCOPE, 'Shared local image successfully.', {
      uriShort: toShortUri(normalizedUri),
    });
    return {
      success: true,
    };
  } catch (error) {
    if (isUserCancelledShare(error)) {
      return {
        success: false,
        reason: 'cancelled',
        message: '',
      };
    }

    Logger.error(SERVICE_SCOPE, 'Failed to share local image.', {
      uriShort: toShortUri(normalizedUri),
      error,
    });
    return {
      success: false,
      reason: 'unknown',
      message: FALLBACK_IMAGE_SHARE_MESSAGE,
    };
  }
}

export async function saveLocalImageToGallery(
  uri: string,
): Promise<SaveLocalImageToGalleryResult> {
  const normalizedUri = normalizeImageUri(uri);
  if (!normalizedUri) {
    return {
      success: false,
      reason: 'invalid_uri',
      message: INVALID_IMAGE_URI_MESSAGE,
    };
  }

  if (!imageFileExists(normalizedUri)) {
    return {
      success: false,
      reason: 'file_missing',
      message: MISSING_IMAGE_FILE_MESSAGE,
    };
  }

  if (Platform.OS !== 'android') {
    return {
      success: false,
      reason: 'save_unavailable',
      message: SAVE_UNAVAILABLE_MESSAGE,
    };
  }

  try {
    const mimeType = guessImageMimeType(normalizedUri);
    const fileName = getImageFileName(normalizedUri);
    const savedUri = await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
      {
        name: fileName,
        parentFolder: IMAGE_SAVE_PARENT_FOLDER,
        mimeType,
      },
      'Image',
      toAndroidFilePath(normalizedUri),
    );

    Logger.info(SERVICE_SCOPE, 'Saved local image to gallery successfully.', {
      sourceUriShort: toShortUri(normalizedUri),
      savedUriShort: toShortUri(savedUri),
      fileName,
      mimeType,
    });
    return {
      success: true,
      savedUri,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to save local image to gallery.', {
      uriShort: toShortUri(normalizedUri),
      error,
    });
    return {
      success: false,
      reason: 'unknown',
      message: FALLBACK_IMAGE_SAVE_MESSAGE,
    };
  }
}

export async function deleteMistakeImages(mistakeId: string): Promise<boolean> {
  try {
    return await deleteMistakeImageFolder(mistakeId);
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Unexpected error in deleteMistakeImages.', {
      mistakeId,
      error,
    });
    return false;
  }
}
