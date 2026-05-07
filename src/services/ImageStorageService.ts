import { Directory, File, Paths } from 'expo-file-system';

import { IMAGE_ROOT_DIR_NAME } from '@/src/constants/image';
import type { LocalImage, LocalImageType, SavedImageResult } from '@/src/models/LocalImage';
import {
  buildImageFileName,
  buildMistakeImageDir,
  createImageId,
  normalizeImageType,
} from '@/src/services/ImagePathService';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'ImageStorageService';
const MISTAKE_IMAGE_NAME_LIMIT = 2000;

type SaveTempImageParams = {
  mistakeId: string;
  type: LocalImageType;
  tempUri: string;
  width?: number;
  height?: number;
  fileSize?: number | null;
  index?: number;
};

function splitRelativePath(relativePath: string): string[] {
  return relativePath.split('/').filter(Boolean);
}

function getRootDirectory(): Directory {
  return new Directory(Paths.document, IMAGE_ROOT_DIR_NAME);
}

function getMistakeDirectory(mistakeId: string): Directory {
  const relativePath = buildMistakeImageDir(mistakeId);
  const segments = splitRelativePath(relativePath);
  return new Directory(Paths.document, ...segments);
}

function normalizeStartIndex(index?: number): number {
  if (index === undefined) {
    return 1;
  }
  const normalized = Math.floor(index);
  return normalized > 0 ? normalized : 1;
}

function resolveTargetFile(
  directory: Directory,
  type: LocalImageType,
  startIndex: number,
): { file: File; fileName: string } {
  let index = startIndex;
  let attempts = 0;

  while (attempts < MISTAKE_IMAGE_NAME_LIMIT) {
    const fileName = buildImageFileName(type, index);
    const file = new File(directory, fileName);
    if (!file.exists) {
      return { file, fileName };
    }
    index += 1;
    attempts += 1;
  }

  const fallbackName = buildImageFileName(type, Date.now());
  return {
    file: new File(directory, fallbackName),
    fileName: fallbackName,
  };
}

export async function ensureImageRootDir(): Promise<string> {
  try {
    const rootDir = getRootDirectory();
    rootDir.create({ intermediates: true, idempotent: true });
    return rootDir.uri;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to ensure image root directory.', error);
    throw error;
  }
}

export async function ensureMistakeImageDir(mistakeId: string): Promise<string> {
  try {
    await ensureImageRootDir();
    const mistakeDir = getMistakeDirectory(mistakeId);
    mistakeDir.create({ intermediates: true, idempotent: true });
    return mistakeDir.uri;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to ensure mistake image directory.', { mistakeId, error });
    throw error;
  }
}

export async function saveTempImageToMistakeFolder(
  params: SaveTempImageParams,
): Promise<SavedImageResult> {
  try {
    const normalizedType = normalizeImageType(params.type);
    const sourceFile = new File(params.tempUri);

    if (!sourceFile.exists) {
      return {
        ok: false,
        errorMessage: 'Temporary image does not exist.',
      };
    }

    const directoryUri = await ensureMistakeImageDir(params.mistakeId);
    const mistakeDir = new Directory(directoryUri);
    const { file: targetFile, fileName } = resolveTargetFile(
      mistakeDir,
      normalizedType,
      normalizeStartIndex(params.index),
    );

    sourceFile.copy(targetFile);

    const fileInfo = targetFile.info();
    const image: LocalImage = {
      id: createImageId(),
      mistakeId: params.mistakeId,
      type: normalizedType,
      uri: targetFile.uri,
      fileName,
      directory: mistakeDir.uri,
      createdAt: new Date().toISOString(),
      width: params.width,
      height: params.height,
      fileSize:
        params.fileSize ?? (typeof fileInfo.size === 'number' ? fileInfo.size : null),
    };

    return {
      ok: true,
      image,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to persist temporary image.', {
      params,
      error,
    });
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getImageInfo(
  uri: string,
): Promise<{ exists: boolean; size?: number | null }> {
  try {
    const file = new File(uri);
    if (!file.exists) {
      return { exists: false, size: null };
    }

    const info = file.info();
    return {
      exists: info.exists,
      size: typeof info.size === 'number' ? info.size : null,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to get image info.', { uri, error });
    return { exists: false, size: null };
  }
}

export async function listMistakeImageFiles(mistakeId: string): Promise<string[]> {
  try {
    const mistakeDir = getMistakeDirectory(mistakeId);
    if (!mistakeDir.exists) {
      return [];
    }

    const entries = mistakeDir.list();
    return entries
      .filter((entry): entry is File => entry instanceof File)
      .map((file) => file.uri)
      .sort();
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to list mistake image files.', { mistakeId, error });
    return [];
  }
}

export async function deleteLocalImage(uri: string): Promise<boolean> {
  try {
    const file = new File(uri);
    if (!file.exists) {
      return false;
    }

    file.delete();
    return true;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to delete local image.', { uri, error });
    return false;
  }
}

export async function deleteMistakeImageFolder(mistakeId: string): Promise<boolean> {
  try {
    const mistakeDir = getMistakeDirectory(mistakeId);
    if (!mistakeDir.exists) {
      return false;
    }

    mistakeDir.delete();
    return true;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to delete mistake image folder.', {
      mistakeId,
      error,
    });
    return false;
  }
}
