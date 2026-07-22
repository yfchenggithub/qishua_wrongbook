import { NativeModules, Platform } from 'react-native';

interface QishuaFileShareNativeModule {
  shareFile(fileUri: string, mimeType: string, dialogTitle: string): Promise<void>;
  shareFiles(fileUris: string[], mimeType: string, dialogTitle: string): Promise<void>;
}

function resolveNativeModule(): QishuaFileShareNativeModule | null {
  if (Platform.OS !== 'android') {
    return null;
  }

  const candidate = (NativeModules as Record<string, unknown>).QishuaFileShareModule as
    | Partial<QishuaFileShareNativeModule>
    | undefined;
  return candidate && typeof candidate.shareFile === 'function'
    ? candidate as QishuaFileShareNativeModule
    : null;
}

export async function shareFile(
  fileUri: string,
  mimeType: string,
  dialogTitle: string,
): Promise<boolean> {
  const nativeModule = resolveNativeModule();
  if (!nativeModule) {
    return false;
  }

  await nativeModule.shareFile(fileUri, mimeType, dialogTitle);
  return true;
}

export async function shareFiles(
  fileUris: string[],
  mimeType: string,
  dialogTitle: string,
): Promise<boolean> {
  const nativeModule = resolveNativeModule();
  if (!nativeModule || typeof nativeModule.shareFiles !== 'function') {
    return false;
  }

  await nativeModule.shareFiles(fileUris, mimeType, dialogTitle);
  return true;
}
