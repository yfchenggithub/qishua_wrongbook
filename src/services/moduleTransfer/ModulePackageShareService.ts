import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import * as AndroidFileShareService from '@/src/services/AndroidFileShareService';
import { Logger } from '@/src/services/Logger';
import type {
  ShareModulePackageInput,
  ShareModulePackageResult,
} from '@/src/services/moduleTransfer/ModulePackageShareTypes';

const SERVICE_SCOPE = 'ModulePackageShareService';
const MODULE_PACKAGE_MIME_TYPE = 'application/octet-stream';
const SHARE_DIALOG_TITLE = '分享七刷题包';

function failure(
  code: Exclude<ShareModulePackageResult, { ok: true }>['code'],
  message: string,
): ShareModulePackageResult {
  return { ok: false, code, message };
}

function isCancelledShare(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const comparable = `${error.name} ${error.message}`.toLocaleLowerCase();
  return comparable.includes('cancel')
    || comparable.includes('dismiss')
    || comparable.includes('abort');
}

export async function shareModulePackage(
  input: ShareModulePackageInput,
): Promise<ShareModulePackageResult> {
  const fileUri = input?.fileUri?.trim() ?? '';
  const fileName = input?.fileName?.trim() ?? '';
  if (!fileUri || !fileName || !fileName.toLocaleLowerCase().endsWith('.qsm')) {
    return failure('invalid_input', '缺少可分享的 .qsm 题包文件。');
  }

  try {
    const file = new File(fileUri);
    if (!file.exists || file.size <= 0) {
      return failure('file_missing', '题包文件已不可访问，请重新生成。');
    }

    const sharedWithAndroidNativeModule = await AndroidFileShareService.shareFile(
      fileUri,
      MODULE_PACKAGE_MIME_TYPE,
      SHARE_DIALOG_TITLE,
    );
    if (!sharedWithAndroidNativeModule) {
      if (!(await Sharing.isAvailableAsync())) {
        return failure('share_unavailable', '当前设备不支持系统文件分享。');
      }
      await Sharing.shareAsync(fileUri, {
        dialogTitle: SHARE_DIALOG_TITLE,
        mimeType: MODULE_PACKAGE_MIME_TYPE,
        UTI: 'public.data',
      });
    }
    Logger.info(SERVICE_SCOPE, 'Opened module package share sheet.', { fileName });
    return { ok: true };
  } catch (error) {
    if (isCancelledShare(error)) {
      Logger.info(SERVICE_SCOPE, 'Module package share was cancelled.', { fileName });
      return failure('cancelled', '已取消系统分享，生成的题包仍可再次分享。');
    }
    Logger.error(SERVICE_SCOPE, 'Failed to share module package.', {
      fileName,
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    return failure('share_failed', '打开系统分享失败，请稍后重试。');
  }
}

export const ModulePackageShareService = {
  shareModulePackage,
} as const;
