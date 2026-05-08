import type { LocalImageType, SavedImageResult } from '@/src/models/LocalImage';
import { optimizeImageForStorage } from '@/src/services/ImageOptimizeService';
import {
  pickImageFromLibrary,
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

export interface SaveImageParams {
  mistakeId: string;
  type: LocalImageType;
  index?: number;
}

export type ImagePermissionResult = PermissionRequestResult;

interface PreparedImagePayload {
  uri: string;
  width?: number;
  height?: number;
  fileSize?: number | null;
}

function canceledResult(errorMessage: string): SavedImageResult {
  return {
    ok: false,
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
  try {
    const picked = await takePhoto();
    if (picked.canceled) {
      return canceledResult(picked.errorMessage ?? 'User canceled taking photo.');
    }

    if (!picked.tempUri) {
      Logger.error(SERVICE_SCOPE, 'Failed to take photo: tempUri is empty.', {
        params,
        picked,
      });
      return canceledResult('Invalid photo result. Please try again.');
    }

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
  try {
    const picked = await pickImageFromLibrary();
    if (picked.canceled) {
      return canceledResult(picked.errorMessage ?? 'User canceled image selection.');
    }

    if (!picked.tempUri) {
      Logger.error(SERVICE_SCOPE, 'Failed to pick image: tempUri is empty.', {
        params,
        picked,
      });
      return canceledResult('Invalid image result. Please try again.');
    }

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
  try {
    return await deleteLocalImageFile(uri);
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Unexpected error in deleteLocalImage.', {
      uri,
      error,
    });
    return false;
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
