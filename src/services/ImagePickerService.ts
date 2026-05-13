import * as ImagePicker from 'expo-image-picker';

import { IMAGE_QUALITY } from '@/src/constants/image';
import type { PickedImageAsset, PickedImageResult, PickedImagesResult } from '@/src/models/LocalImage';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'ImagePickerService';

export interface PermissionRequestResult {
  granted: boolean;
  canAskAgain?: boolean;
  status?: string;
  message?: string;
}

function buildPermissionResult(
  permission: ImagePicker.CameraPermissionResponse | ImagePicker.MediaLibraryPermissionResponse,
  deniedMessage: string,
): PermissionRequestResult {
  if (permission.granted) {
    return {
      granted: true,
      canAskAgain: permission.canAskAgain,
      status: permission.status,
    };
  }

  return {
    granted: false,
    canAskAgain: permission.canAskAgain,
    status: permission.status,
    message: deniedMessage,
  };
}

function canceledWithError(errorMessage: string): PickedImageResult {
  return {
    canceled: true,
    errorMessage,
  };
}

function mapPickedResult(result: ImagePicker.ImagePickerResult): PickedImageResult {
  if (result.canceled) {
    return { canceled: true };
  }

  const asset = result.assets[0];
  if (!asset?.uri) {
    return canceledWithError('Image picker returned empty asset.');
  }

  return {
    canceled: false,
    tempUri: asset.uri,
    width: asset.width,
    height: asset.height,
    fileSize: asset.fileSize ?? null,
  };
}

function mapPickedAssets(result: ImagePicker.ImagePickerResult): PickedImageAsset[] {
  if (result.canceled || !Array.isArray(result.assets)) {
    return [];
  }

  return result.assets
    .filter((asset): asset is ImagePicker.ImagePickerAsset => !!asset?.uri)
    .map((asset) => ({
      tempUri: asset.uri,
      width: asset.width,
      height: asset.height,
      fileSize: asset.fileSize ?? null,
    }));
}

export async function requestCameraPermission(): Promise<PermissionRequestResult> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    return buildPermissionResult(permission, 'Camera permission is required to take a photo.');
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to request camera permission.', error);
    return {
      granted: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function requestMediaLibraryPermission(): Promise<PermissionRequestResult> {
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return buildPermissionResult(
      permission,
      'Media library permission is required to pick a photo.',
    );
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to request media library permission.', error);
    return {
      granted: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function takePhoto(): Promise<PickedImageResult> {
  try {
    const permission = await requestCameraPermission();
    if (!permission.granted) {
      return canceledWithError(permission.message ?? 'Camera permission denied.');
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: IMAGE_QUALITY,
      base64: false,
      exif: false,
    });

    return mapPickedResult(result);
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to take photo.', error);
    return canceledWithError(error instanceof Error ? error.message : String(error));
  }
}

export async function pickImageFromLibrary(): Promise<PickedImageResult> {
  try {
    const permission = await requestMediaLibraryPermission();
    if (!permission.granted) {
      return canceledWithError(permission.message ?? 'Media library permission denied.');
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: IMAGE_QUALITY,
      base64: false,
      exif: false,
      allowsMultipleSelection: false,
    });

    return mapPickedResult(result);
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to pick image from library.', error);
    return canceledWithError(error instanceof Error ? error.message : String(error));
  }
}

export async function pickImagesFromLibrary(maxSelection?: number): Promise<PickedImagesResult> {
  try {
    const permission = await requestMediaLibraryPermission();
    if (!permission.granted) {
      return {
        canceled: true,
        errorMessage: permission.message ?? 'Media library permission denied.',
      };
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: IMAGE_QUALITY,
      base64: false,
      exif: false,
      allowsMultipleSelection: true,
      selectionLimit: typeof maxSelection === 'number' && maxSelection > 0 ? maxSelection : 0,
    });

    if (result.canceled) {
      return { canceled: true };
    }

    const assets = mapPickedAssets(result);
    if (assets.length === 0) {
      return {
        canceled: true,
        errorMessage: 'Image picker returned empty assets.',
      };
    }

    return {
      canceled: false,
      assets,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to pick images from library.', error);
    return {
      canceled: true,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export function openPermissionHelp(): string {
  return 'Permission denied. Please enable Camera/Photos permission in system settings and retry.';
}
