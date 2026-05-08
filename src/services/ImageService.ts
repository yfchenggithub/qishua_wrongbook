import type { LocalImageType, SavedImageResult } from "@/src/models/LocalImage";
import {
  pickImageFromLibrary,
  takePhoto,
} from "@/src/services/ImagePickerService";
import {
  deleteLocalImage as deleteLocalImageFile,
  deleteMistakeImageFolder,
  getImageInfo,
  saveTempImageToMistakeFolder,
} from "@/src/services/ImageStorageService";
import { Logger } from "@/src/services/Logger";

const SERVICE_SCOPE = "ImageService";

export interface SaveImageParams {
  mistakeId: string;
  type: LocalImageType;
  index?: number;
}

function canceledResult(errorMessage: string): SavedImageResult {
  return {
    ok: false,
    errorMessage,
  };
}

export async function takePhotoAndSave(
  params: SaveImageParams,
): Promise<SavedImageResult> {
  try {
    const picked = await takePhoto();
    if (picked.canceled) {
      return canceledResult(picked.errorMessage ?? "用户取消拍照");
    }

    if (!picked.tempUri) {
      Logger.error(SERVICE_SCOPE, "Failed to take photo: tempUri is empty.", {
        params,
        picked,
      });
      return canceledResult("拍照结果无效，请重试");
    }

    const savedResult = await saveTempImageToMistakeFolder({
      mistakeId: params.mistakeId,
      type: params.type,
      tempUri: picked.tempUri,
      width: picked.width,
      height: picked.height,
      fileSize: picked.fileSize ?? null,
      index: params.index,
    });

    if (!savedResult.ok) {
      Logger.error(
        SERVICE_SCOPE,
        "Failed to save taken photo to local folder.",
        {
          params,
          savedResult,
        },
      );
    }

    return savedResult;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, "Unexpected error in takePhotoAndSave.", {
      params,
      error,
    });
    return canceledResult(
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function pickImageAndSave(
  params: SaveImageParams,
): Promise<SavedImageResult> {
  try {
    const picked = await pickImageFromLibrary();
    if (picked.canceled) {
      return canceledResult(picked.errorMessage ?? "用户取消选图");
    }

    if (!picked.tempUri) {
      Logger.error(SERVICE_SCOPE, "Failed to pick image: tempUri is empty.", {
        params,
        picked,
      });
      return canceledResult("选图结果无效，请重试");
    }

    const savedResult = await saveTempImageToMistakeFolder({
      mistakeId: params.mistakeId,
      type: params.type,
      tempUri: picked.tempUri,
      width: picked.width,
      height: picked.height,
      fileSize: picked.fileSize ?? null,
      index: params.index,
    });

    if (!savedResult.ok) {
      Logger.error(
        SERVICE_SCOPE,
        "Failed to save picked image to local folder.",
        {
          params,
          savedResult,
        },
      );
    }

    return savedResult;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, "Unexpected error in pickImageAndSave.", {
      params,
      error,
    });
    return canceledResult(
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function getLocalImageInfo(
  uri: string,
): Promise<{ exists: boolean; size?: number | null }> {
  try {
    return await getImageInfo(uri);
  } catch (error) {
    Logger.error(SERVICE_SCOPE, "Unexpected error in getLocalImageInfo.", {
      uri,
      error,
    });
    return { exists: false, size: null };
  }
}

export async function deleteLocalImage(uri: string): Promise<boolean> {
  try {
    return await deleteLocalImageFile(uri);
  } catch (error) {
    Logger.error(SERVICE_SCOPE, "Unexpected error in deleteLocalImage.", {
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
    Logger.error(SERVICE_SCOPE, "Unexpected error in deleteMistakeImages.", {
      mistakeId,
      error,
    });
    return false;
  }
}
