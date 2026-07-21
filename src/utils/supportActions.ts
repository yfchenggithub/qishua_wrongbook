import * as Clipboard from 'expo-clipboard';

import type { AppToastType } from '@/src/components/ui/AppToast';

type ShowToast = (message: string, type?: AppToastType, duration?: number) => void;

export async function copySupportText(
  value: string,
  successMessage: string,
  showToast: ShowToast,
): Promise<boolean> {
  if (typeof Clipboard.setStringAsync !== 'function') {
    showToast('当前设备不支持复制', 'error');
    return false;
  }

  try {
    await Clipboard.setStringAsync(value);
    showToast(successMessage, 'success');
    return true;
  } catch {
    showToast('复制失败，请稍后重试', 'error');
    return false;
  }
}
